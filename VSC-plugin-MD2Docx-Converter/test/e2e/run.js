const path = require('path');
const fs = require('fs');
const os = require('os');
const fsp = require('fs/promises');
const { execFile } = require('child_process');
const { promisify } = require('util');
const AdmZip = require('adm-zip');
const {
    buildDocxStyleOverrides,
    upsertStyleOverride,
    normalizeDocxStyleOrder
} = require('../../out/docxStyles.js');

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.join(__dirname, '..', '..');
const TEMPLATE_DIR = path.join(REPO_ROOT, 'multi-templates');
const PROFILES = ['academic', 'business', 'technical', 'official', 'thesis'];
const LANGUAGES = ['english', 'chinese'];

// What each profile must produce. Measured from the exported documents, not
// guessed: Normal carries the body font and size, Heading 1 the heading font
// and size, and the margins come from the preset.
const EXPECTED = {
    academic: {
        bodyFont: 'Times New Roman', bodySizePt: 12,
        headingFont: 'Times New Roman', headingSizePt: 16,
        marginsMm: [25.4, 25.4, 31.75, 31.75]
    },
    business: {
        bodyFont: 'Arial', bodySizePt: 11,
        headingFont: 'Arial', headingSizePt: 18,
        marginsMm: [25.4, 25.4, 25.4, 25.4]
    },
    technical: {
        bodyFont: 'Arial', bodySizePt: 11,
        headingFont: 'Arial', headingSizePt: 16,
        marginsMm: [19, 19, 19, 19]
    },
    official: {
        bodyFont: 'Times New Roman', bodySizePt: 16,
        headingFont: 'Times New Roman', headingSizePt: 16,
        marginsMm: [37, 35, 28, 26]
    },
    thesis: {
        bodyFont: 'Times New Roman', bodySizePt: 12,
        headingFont: 'Times New Roman', headingSizePt: 22,
        marginsMm: [30, 30, 30, 30]
    }
};

const TWIPS_PER_MM = 56.6929133858;

function run(command, args, options = {}) {
    return execFileAsync(command, args, {
        cwd: options.cwd,
        shell: process.platform === 'win32' && /\.(cmd|bat)$/i.test(command),
        windowsHide: true
    });
}

async function pandocVersion() {
    const { stdout } = await run('pandoc', ['--version']);
    return stdout.split('\n')[0].trim();
}

/** Apply the extension's own style override layer to an exported document. */
function applyStyleOverrides(outputPath, profile) {
    const zip = new AdmZip(outputPath);
    const stylesEntry = zip.getEntry('word/styles.xml');
    let stylesXml = stylesEntry.getData().toString('utf8');

    const overrides = buildDocxStyleOverrides({
        styleProfile: profile,
        bodyFont: '',
        bodySizePt: undefined,
        heading1Font: '',
        heading1SizePt: undefined,
        heading2Font: '',
        heading2SizePt: undefined,
        heading3Font: '',
        heading3SizePt: undefined,
        lineSpacing: undefined
    });

    for (const override of overrides) {
        stylesXml = upsertStyleOverride(stylesXml, override);
    }
    stylesXml = normalizeDocxStyleOrder(stylesXml);

    zip.updateFile(stylesEntry, Buffer.from(stylesXml, 'utf8'));
    zip.writeZip(outputPath);
}

function readMargins(sectPr) {
    const pgMar = sectPr.match(/<w:pgMar\b[^>]*\/>/);
    if (!pgMar) {
        return [];
    }
    return ['top', 'bottom', 'left', 'right'].map((side) => {
        const value = pgMar[0].match(new RegExp(`w:${side}="(-?\\d+)"`));
        return value ? Math.round((Number(value[1]) / TWIPS_PER_MM) * 100) / 100 : NaN;
    });
}

async function exportOne(profile, language, workDir) {
    const markdownPath = path.join(workDir, 'sample.md');
    const outputPath = path.join(workDir, `sample-${profile}-${language}.docx`);
    const referenceDocx = path.join(TEMPLATE_DIR, `reference_${language}_${profile}.docx`);

    if (!fs.existsSync(referenceDocx)) {
        throw new Error(`missing template ${referenceDocx}`);
    }

    await run('pandoc', [
        markdownPath,
        '--from', 'gfm+raw_html',
        '--to', 'docx',
        '--output', outputPath,
        '--reference-doc', referenceDocx
    ], { cwd: workDir });

    applyStyleOverrides(outputPath, profile);

    const zip = new AdmZip(outputPath);
    const document = zip.readAsText('word/document.xml');
    const sectPr = document.match(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/)[0];

    if (/w:num="2"/.test(sectPr)) {
        throw new Error(`${profile}/${language} produced a two-column document`);
    }
    // The attribute order inside <w:pgSz> is alphabetical, so read the two
    // values rather than matching the whole element.
    const pgSz = sectPr.match(/<w:pgSz\b[^>]*\/>/);
    const pageWidth = pgSz && pgSz[0].match(/w:w="(\d+)"/);
    const pageHeight = pgSz && pgSz[0].match(/w:h="(\d+)"/);
    if (!pageWidth || !pageHeight || pageWidth[1] !== '11906' || pageHeight[1] !== '16838') {
        throw new Error(`${profile}/${language} is not A4`);
    }
    if (!zip.getEntry('word/footer1.xml')) {
        throw new Error(`${profile}/${language} lost the page-number footer`);
    }

    // The preset must actually reach the document: body font and size on
    // Normal, heading font and size on Heading 1, and the preset margins.
    const expected = EXPECTED[profile];
    const styles = zip.readAsText('word/styles.xml');

    const normal = styles.match(/<w:style[^>]*w:styleId="Normal"[\s\S]*?<\/w:style>/);
    if (!normal || !normal[0].includes(`w:ascii="${expected.bodyFont}"`)) {
        throw new Error(`${profile}/${language} did not apply the body font ${expected.bodyFont}`);
    }
    if (!normal || !normal[0].includes(`<w:sz w:val="${expected.bodySizePt * 2}"/>`)) {
        throw new Error(`${profile}/${language} did not apply the body size ${expected.bodySizePt}pt`);
    }

    const heading = styles.match(/<w:style[^>]*w:styleId="Heading1"[\s\S]*?<\/w:style>/);
    if (!heading || !heading[0].includes(`w:ascii="${expected.headingFont}"`)) {
        throw new Error(`${profile}/${language} did not apply the heading font ${expected.headingFont}`);
    }
    if (!heading || !heading[0].includes(`<w:sz w:val="${expected.headingSizePt * 2}"/>`)) {
        throw new Error(`${profile}/${language} did not apply the heading size ${expected.headingSizePt}pt`);
    }

    const margins = readMargins(sectPr);
    expected.marginsMm.forEach((want, index) => {
        const side = ['top', 'bottom', 'left', 'right'][index];
        if (!(Math.abs(margins[index] - want) <= 0.05)) {
            throw new Error(`${profile}/${language} margin ${side} is ${margins[index]}mm, expected ${want}mm`);
        }
    });

    return outputPath;
}

async function main() {
    const markdown = '# Sample Title\n\nSome body text for the export test.\n\n## Section\n\nMore text.\n';
    const workDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mdocx-e2e-'));

    try {
        console.log('Pandoc:', await pandocVersion());
        await fsp.writeFile(path.join(workDir, 'sample.md'), markdown, 'utf8');

        for (const profile of PROFILES) {
            for (const language of LANGUAGES) {
                const output = await exportOne(profile, language, workDir);
                console.log(`OK ${profile}/${language} -> ${path.basename(output)}`);
            }
        }

        console.log('\nAll e2e exports succeeded.');
    } finally {
        await fsp.rm(workDir, { recursive: true, force: true });
    }
}

main().catch((error) => {
    console.error('E2E FAILED:', error.message);
    process.exit(1);
});
