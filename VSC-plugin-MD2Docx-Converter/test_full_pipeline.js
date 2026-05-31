const path = require('path');
const os = require('os');
const fs = require('fs');
const fsp = require('fs/promises');
const { execFile } = require('child_process');
const { promisify } = require('util');
const AdmZip = require('adm-zip');
const execFileAsync = promisify(execFile);

const IS_WIN = process.platform === 'win32';

function shouldRunThroughShell(command) {
    return IS_WIN && /\.(cmd|bat)$/i.test(command);
}

async function runExecutable(command, args, opts) {
    return execFileAsync(command, args, {
        cwd: opts.cwd,
        shell: opts.shell !== undefined ? opts.shell : shouldRunThroughShell(command),
        windowsHide: true,
        maxBuffer: opts.maxBuffer || 16 * 1024 * 1024
    });
}

async function resolveExecutable(candidates, versionArgs) {
    const seen = new Set();
    for (const candidate of candidates) {
        const normalized = candidate.trim();
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        try {
            const shell = shouldRunThroughShell(normalized);
            const { stdout, stderr } = await runExecutable(normalized, versionArgs, { shell });
            const versionLine = [stdout, stderr].join('\n').split(/\r?\n/).map(l => l.trim()).find(Boolean) || 'unknown';
            return { command: normalized, versionLine, shell };
        } catch { /* try next */ }
    }
    return undefined;
}

function getMermaidCandidates(markdownPath) {
    const commandName = IS_WIN ? 'mmdc.cmd' : 'mmdc';
    const candidates = ['mmdc', commandName];
    if (IS_WIN && process.env.APPDATA) {
        candidates.push(path.join(process.env.APPDATA, 'npm', 'mmdc.cmd'));
    }
    return [...new Set(candidates)];
}

function getPandocCandidates() {
    const candidates = ['pandoc'];
    if (IS_WIN) {
        const localAppData = process.env.LOCALAPPDATA;
        candidates.push(
            localAppData ? path.join(localAppData, 'Pandoc', 'pandoc.exe') : '',
            localAppData ? path.join(localAppData, 'Microsoft', 'WinGet', 'Links', 'pandoc.exe') : ''
        );
    }
    return [...new Set(candidates)];
}

async function main() {
    const extensionPath = process.env.USERPROFILE + '/.vscode/extensions/alexmultiagent.mdocx-converter-0.2.11';
    const markdownPath = 'd:/GitHub/mdocx-converter/examples/sample.md';
    const markdownDir = path.dirname(markdownPath);
    const markdownStem = path.parse(markdownPath).name;
    const outputPath = path.join(markdownDir, markdownStem + '.docx');
    const styleProfile = 'template';

    console.log('=== STEP 1: Read markdown ===');
    console.log('Markdown path:', markdownPath);
    console.log('Output path:', outputPath);
    const markdownText = await fsp.readFile(markdownPath, 'utf8');
    console.log('Content length:', markdownText.length);

    console.log('\n=== STEP 2: Resolve Pandoc ===');
    const pandoc = await resolveExecutable(getPandocCandidates(), ['--version']);
    if (!pandoc) { console.error('PANDOC NOT FOUND'); process.exit(1); }
    console.log('Pandoc:', pandoc.command, '-', pandoc.versionLine);

    console.log('\n=== STEP 3: Detect language ===');
    const sample = markdownText.slice(0, 20000);
    const chineseMatches = (sample.match(/[㐀-䶿一-鿿豈-﫿]/g) || []).length;
    const englishMatches = (sample.match(/[A-Za-z]/g) || []).length;
    const language = (chineseMatches >= 40 || chineseMatches > englishMatches * 0.15) ? 'chinese' : 'english';
    console.log('Detected:', language);

    console.log('\n=== STEP 4: Resolve reference DOCX ===');
    const refDocxMap = {
        template: { english: 'multi-templates/reference_english_academic.docx', chinese: 'multi-templates/reference_chinese_academic.docx' }
    };
    const referenceDocx = path.join(extensionPath, refDocxMap[styleProfile][language]);
    console.log('Reference DOCX:', referenceDocx);
    console.log('Exists:', fs.existsSync(referenceDocx));

    console.log('\n=== STEP 5: Check for mermaid blocks ===');
    const mermaidRegex = /```mermaid[^\n]*\r?\n([\s\S]*?)```/gi;
    const mermaidMatches = [...markdownText.matchAll(mermaidRegex)];
    console.log('Mermaid blocks found:', mermaidMatches.length);

    if (mermaidMatches.length > 0) {
        console.log('\n=== STEP 6: Resolve Mermaid CLI ===');
        const mermaid = await resolveExecutable(getMermaidCandidates(markdownPath), ['--version']);
        if (!mermaid) { console.error('MERMAID CLI NOT FOUND'); process.exit(1); }
        console.log('Mermaid CLI:', mermaid.command, '-', mermaid.versionLine);

        const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mdocx-converter-'));
        const assetsDir = path.join(tempDir, 'mermaid-assets');
        await fsp.mkdir(assetsDir, { recursive: true });

        let processedMarkdown = '';
        let lastIndex = 0;
        let blockIndex = 0;

        for (const match of mermaidMatches) {
            const fullMatch = match[0];
            const diagramBody = match[1];
            const matchIndex = match.index;

            processedMarkdown += markdownText.slice(lastIndex, matchIndex);
            blockIndex++;

            const inputPath = path.join(assetsDir, 'diagram-' + blockIndex + '.mmd');
            const imgOutputPath = path.join(assetsDir, 'diagram-' + blockIndex + '.png');
            await fsp.writeFile(inputPath, diagramBody.trim(), 'utf8');

            console.log('Rendering diagram', blockIndex, 'with', mermaid.command, '...');
            const result = await runExecutable(mermaid.command, [
                '-i', inputPath, '-o', imgOutputPath, '-b', 'transparent'
            ], { cwd: markdownDir });
            console.log('  stdout:', result.stdout || '(empty)');
            console.log('  stderr:', result.stderr || '(empty)');
            console.log('  Image exists:', fs.existsSync(imgOutputPath), 'size:', fs.statSync(imgOutputPath).size);

            const relativePath = './mermaid-assets/diagram-' + blockIndex + '.png';
            if (processedMarkdown.length > 0 && !/\n\s*\n$/.test(processedMarkdown)) {
                processedMarkdown += processedMarkdown.endsWith('\n') ? '\n' : '\n\n';
            }
            processedMarkdown += '![Mermaid Diagram ' + blockIndex + '](' + relativePath + ')\n\n';
            lastIndex = matchIndex + fullMatch.length;
        }

        processedMarkdown += markdownText.slice(lastIndex);
        const preparedMarkdownPath = path.join(tempDir, path.basename(markdownPath));
        await fsp.writeFile(preparedMarkdownPath, processedMarkdown, 'utf8');

        console.log('\n=== STEP 7: Run Pandoc with prepared markdown ===');
        const resourcePathEntries = [markdownDir, tempDir];
        const args = [
            preparedMarkdownPath,
            '--from', 'gfm+raw_html', '--to', 'docx', '--output', outputPath,
            '--resource-path', resourcePathEntries.join(';'),
            '--reference-doc', referenceDocx
        ];
        console.log('Args:', args.join(' '));
        const pandocResult = await runExecutable(pandoc.command, args, { cwd: markdownDir });
        console.log('  stdout:', pandocResult.stdout || '(empty)');
        console.log('  stderr:', pandocResult.stderr || '(empty)');
        console.log('  Output exists:', fs.existsSync(outputPath));
        console.log('  Output size:', fs.statSync(outputPath).size);

        await fsp.rm(tempDir, { recursive: true, force: true });
        console.log('Cleaned up temp dir');
    } else {
        console.log('\n=== STEP 6: Run Pandoc directly ===');
        const args = [
            markdownPath,
            '--from', 'gfm+raw_html', '--to', 'docx', '--output', outputPath,
            '--resource-path', markdownDir,
            '--reference-doc', referenceDocx
        ];
        console.log('Args:', args.join(' '));
        const pandocResult = await runExecutable(pandoc.command, args, { cwd: markdownDir });
        console.log('  stdout:', pandocResult.stdout || '(empty)');
        console.log('  stderr:', pandocResult.stderr || '(empty)');
        console.log('  Output exists:', fs.existsSync(outputPath));
    }

    console.log('\n=== STEP 8: Verify DOCX ===');
    const zip = new AdmZip(outputPath);
    console.log('DOCX entries:', zip.getEntries().map(e => e.entryName).join(', '));
    console.log('DOCX is valid');

    console.log('\n=== RESULT: SUCCESS ===');
    console.log('Output:', outputPath);
    console.log('Size:', fs.statSync(outputPath).size, 'bytes');
}

main().catch(err => {
    console.error('\n=== RESULT: FAILED ===');
    console.error('Error:', err.message);
    if (err.stderr) console.error('stderr:', err.stderr);
    if (err.stdout) console.error('stdout:', err.stdout);
});
