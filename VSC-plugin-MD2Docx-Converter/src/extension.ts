import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { promises as fsp } from 'fs';
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import AdmZip = require('adm-zip');

const execFileAsync = promisify(execFile);
const OUTPUT_CHANNEL_NAME = 'mdocx-converter';
const EXPORT_COMMAND_ID = 'mdocxConverter.exportToDocx';
const EXPORT_ACADEMIC_PAPER_COMMAND_ID = 'mdocxConverter.exportAcademicPaper';
const EXPORT_TECHNICAL_DOCUMENT_COMMAND_ID = 'mdocxConverter.exportTechnicalDocument';
const EXPORT_BUSINESS_REPORT_COMMAND_ID = 'mdocxConverter.exportBusinessReport';
const CHECK_ENVIRONMENT_COMMAND_ID = 'mdocxConverter.checkEnvironment';
const CONFIGURATION_SECTION = 'mdocxConverter';
const LEGACY_CONFIGURATION_SECTION = 'paperifyMd';
const MERMAID_BLOCK_REGEX = /```mermaid[^\n]*\r?\n([\s\S]*?)```/gi;
const BUNDLED_REFERENCE_DOCX_BY_PROFILE_AND_LANGUAGE: Record<StyleProfile, Record<ReferenceLanguage, string>> = {
    template: {
        english: path.join('multi-templates', 'reference_english_academic.docx'),
        chinese: path.join('multi-templates', 'reference_chinese_academic.docx')
    },
    academic: {
        english: path.join('multi-templates', 'reference_english_academic.docx'),
        chinese: path.join('multi-templates', 'reference_chinese_academic.docx')
    },
    technical: {
        english: path.join('multi-templates', 'reference_english_technical.docx'),
        chinese: path.join('multi-templates', 'reference_chinese_technical.docx')
    },
    business: {
        english: path.join('multi-templates', 'reference_english_business.docx'),
        chinese: path.join('multi-templates', 'reference_chinese_business.docx')
    }
};
const STYLE_PROFILE_METADATA: Record<StyleProfile, Record<string, string>> = {
    template: {},
    academic: {
        'mainfont': 'Times New Roman',
        'CJKmainfont': 'SimSun',
        'fontsize': '12pt',
        'linestretch': '1.5'
    },
    business: {
        'mainfont': 'Arial',
        'CJKmainfont': 'Microsoft YaHei',
        'fontsize': '11pt',
        'linestretch': '1.25'
    },
    technical: {
        'mainfont': 'Arial',
        'CJKmainfont': 'Microsoft YaHei',
        'monofont': 'Consolas',
        'fontsize': '11pt',
        'linestretch': '1.2'
    }
};

type ReferenceLanguage = 'english' | 'chinese';
type ReferenceLanguageSetting = ReferenceLanguage | 'auto';
type StyleProfile = 'template' | 'academic' | 'business' | 'technical';

interface ExportSettings {
    pandocPath: string;
    mermaidCliPath: string;
    referenceDocx: string;
    referenceLanguage: ReferenceLanguageSetting;
    outputDirectory: string;
    mermaidOutputFormat: 'png' | 'svg';
    openAfterExport: boolean;
    keepIntermediateFiles: boolean;
    styleProfile: StyleProfile;
    bodyFont: string;
    bodySizePt: number | undefined;
    heading1Font: string;
    heading1SizePt: number | undefined;
    heading2Font: string;
    heading2SizePt: number | undefined;
    heading3Font: string;
    heading3SizePt: number | undefined;
    lineSpacing: number | undefined;
    marginTopMm: number | undefined;
    marginBottomMm: number | undefined;
    marginLeftMm: number | undefined;
    marginRightMm: number | undefined;
}

interface ResolvedExecutable {
    command: string;
    versionLine: string;
    useShell?: boolean;
}

interface PreparedMarkdown {
    markdownPath: string;
    tempDir?: string;
    mermaidCount: number;
}

class UserFacingError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'UserFacingError';
    }
}

export function activate(context: vscode.ExtensionContext): void {
    const outputChannel = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
    context.subscriptions.push(outputChannel);

    const exportDisposable = vscode.commands.registerCommand(EXPORT_COMMAND_ID, async (uri?: vscode.Uri) => {
        await runExport(uri, outputChannel, context.extensionPath);
    });
    const exportAcademicPaperDisposable = vscode.commands.registerCommand(EXPORT_ACADEMIC_PAPER_COMMAND_ID, async (uri?: vscode.Uri) => {
        await runExport(uri, outputChannel, context.extensionPath, {
            styleProfile: 'academic',
            referenceLanguage: 'auto'
        });
    });
    const exportTechnicalDocumentDisposable = vscode.commands.registerCommand(EXPORT_TECHNICAL_DOCUMENT_COMMAND_ID, async (uri?: vscode.Uri) => {
        await runExport(uri, outputChannel, context.extensionPath, {
            styleProfile: 'technical',
            referenceLanguage: 'auto'
        });
    });
    const exportBusinessReportDisposable = vscode.commands.registerCommand(EXPORT_BUSINESS_REPORT_COMMAND_ID, async (uri?: vscode.Uri) => {
        await runExport(uri, outputChannel, context.extensionPath, {
            styleProfile: 'business',
            referenceLanguage: 'auto'
        });
    });
    const checkEnvironmentDisposable = vscode.commands.registerCommand(CHECK_ENVIRONMENT_COMMAND_ID, async (uri?: vscode.Uri) => {
        await checkEnvironment(uri, outputChannel);
    });

    context.subscriptions.push(
        exportDisposable,
        exportAcademicPaperDisposable,
        exportTechnicalDocumentDisposable,
        exportBusinessReportDisposable,
        checkEnvironmentDisposable
    );
}

export function deactivate(): void {
    // No-op.
}

async function runExport(
    uri: vscode.Uri | undefined,
    outputChannel: vscode.OutputChannel,
    extensionPath: string,
    exportOverrides?: ExportOverrides
): Promise<void> {
    const markdownUri = getMarkdownUri(uri);
    if (!markdownUri) {
        void vscode.window.showErrorMessage('Open a Markdown file or right-click a .md file to export it.');
        return;
    }

    outputChannel.clear();
    outputChannel.show(true);
    outputChannel.appendLine(`Starting export for ${markdownUri.fsPath}`);

    let prepared: PreparedMarkdown | undefined;

    try {
        const settings = readSettings(markdownUri, exportOverrides);
        const outputPath = await resolveOutputPath(markdownUri, settings.outputDirectory);
        const markdownText = await fsp.readFile(markdownUri.fsPath, 'utf8');
        const resolvedLanguage = resolveReferenceLanguage(markdownText, settings.referenceLanguage);
        const referenceDocx = await resolveReferenceDocx(markdownUri, settings.referenceDocx, resolvedLanguage, settings.styleProfile, extensionPath);

        logMissingLocalImages(markdownUri.fsPath, markdownText, outputChannel);

        prepared = await prepareMarkdown(markdownUri.fsPath, markdownText, settings, outputChannel);

        const pandoc = await requirePandoc(settings.pandocPath);
        outputChannel.appendLine(`Using Pandoc: ${pandoc.command}`);
        outputChannel.appendLine(`Pandoc version: ${pandoc.versionLine}`);

        if (referenceDocx) {
            outputChannel.appendLine(`Using reference DOCX: ${referenceDocx}`);
            outputChannel.appendLine(`Reference language mode: ${settings.referenceLanguage} -> ${resolvedLanguage}`);
        } else {
            outputChannel.appendLine('No reference DOCX found. Exporting with Pandoc defaults.');
        }

        await runPandoc({
            pandoc,
            sourceMarkdownPath: prepared.markdownPath,
            originalMarkdownPath: markdownUri.fsPath,
            outputPath,
            referenceDocx,
            settings,
            tempDir: prepared.tempDir,
            outputChannel
        });

        outputChannel.appendLine(`Export completed: ${outputPath}`);
        void vscode.window.showInformationMessage(`DOCX exported successfully: ${path.basename(outputPath)}`);

        if (settings.openAfterExport) {
            await openExportedDocx(outputPath, outputChannel);
        }
    } catch (error) {
        const message = getErrorMessage(error);
        outputChannel.appendLine(`Export failed: ${message}`);
        void vscode.window.showErrorMessage(message);
    } finally {
        if (prepared?.tempDir) {
            const settings = readSettings(markdownUri, exportOverrides);
            if (!settings.keepIntermediateFiles) {
                await fsp.rm(prepared.tempDir, { recursive: true, force: true });
            } else {
                outputChannel.appendLine(`Kept intermediate files in: ${prepared.tempDir}`);
            }
        }
    }
}

interface ExportOverrides {
    styleProfile?: StyleProfile;
    referenceLanguage?: ReferenceLanguageSetting;
}

async function checkEnvironment(uri: vscode.Uri | undefined, outputChannel: vscode.OutputChannel): Promise<void> {
    const markdownUri = getMarkdownUri(uri) ?? vscode.Uri.file(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd());
    const settings = readSettings(markdownUri);

    outputChannel.clear();
    outputChannel.show(true);
    outputChannel.appendLine('Checking mdocx-converter export environment...');

    const pandoc = await resolvePandoc(settings.pandocPath);
    if (pandoc) {
        outputChannel.appendLine(`OK Pandoc: ${pandoc.command}`);
        outputChannel.appendLine(`   ${pandoc.versionLine}`);
    } else {
        outputChannel.appendLine('MISSING Pandoc');
        outputChannel.appendLine(`   ${getPandocInstallHelp()}`);
    }

    const mermaid = await resolveMermaidCli(settings.mermaidCliPath, markdownUri.fsPath);
    if (mermaid) {
        outputChannel.appendLine(`OK Mermaid CLI: ${mermaid.command}`);
        outputChannel.appendLine(`   ${mermaid.versionLine}`);
    } else {
        outputChannel.appendLine('MISSING Mermaid CLI');
        outputChannel.appendLine('   Required only for ```mermaid code fences. Install with: npm install -g @mermaid-js/mermaid-cli');
        outputChannel.appendLine('   Or set mdocxConverter.mermaidCliPath.');
    }

    if (pandoc && mermaid) {
        void vscode.window.showInformationMessage('mdocx-converter export environment looks ready.');
    } else if (pandoc) {
        void vscode.window.showWarningMessage('Pandoc is ready. Mermaid CLI is missing, so Mermaid diagrams will not export until mmdc is installed.');
    } else {
        void vscode.window.showWarningMessage('Pandoc is missing. Install Pandoc before exporting DOCX files.');
    }
}

function getMarkdownUri(uri?: vscode.Uri): vscode.Uri | undefined {
    if (uri?.fsPath.toLowerCase().endsWith('.md')) {
        return uri;
    }

    const activeDocument = vscode.window.activeTextEditor?.document;
    if (activeDocument && activeDocument.uri.fsPath.toLowerCase().endsWith('.md')) {
        return activeDocument.uri;
    }

    return undefined;
}

function readSettings(markdownUri: vscode.Uri, exportOverrides?: ExportOverrides): ExportSettings {
    const config = vscode.workspace.getConfiguration(CONFIGURATION_SECTION, markdownUri);
    const legacyConfig = vscode.workspace.getConfiguration(LEGACY_CONFIGURATION_SECTION, markdownUri);
    return {
        pandocPath: readConfigValue(config, legacyConfig, 'pandocPath', 'pandoc').trim() || 'pandoc',
        mermaidCliPath: readConfigValue(config, legacyConfig, 'mermaidCliPath', 'mmdc').trim() || 'mmdc',
        referenceDocx: readConfigValue(config, legacyConfig, 'referenceDocx', '').trim(),
        referenceLanguage: exportOverrides?.referenceLanguage ?? normalizeReferenceLanguageSetting(readConfigValue(config, legacyConfig, 'referenceLanguage', 'auto')),
        outputDirectory: readConfigValue(config, legacyConfig, 'outputDirectory', '').trim(),
        mermaidOutputFormat: readConfigValue<'png' | 'svg'>(config, legacyConfig, 'mermaidOutputFormat', 'png'),
        openAfterExport: readConfigValue(config, legacyConfig, 'openAfterExport', false),
        keepIntermediateFiles: readConfigValue(config, legacyConfig, 'keepIntermediateFiles', false),
        styleProfile: exportOverrides?.styleProfile ?? normalizeStyleProfile(readConfigValue(config, legacyConfig, 'styleProfile', 'template')),
        bodyFont: readConfigValue(config, legacyConfig, 'bodyFont', '').trim(),
        bodySizePt: normalizePositiveNumber(readConfigValue<number | undefined>(config, legacyConfig, 'bodySizePt', undefined)),
        heading1Font: readConfigValue(config, legacyConfig, 'heading1Font', '').trim(),
        heading1SizePt: normalizePositiveNumber(readConfigValue<number | undefined>(config, legacyConfig, 'heading1SizePt', undefined)),
        heading2Font: readConfigValue(config, legacyConfig, 'heading2Font', '').trim(),
        heading2SizePt: normalizePositiveNumber(readConfigValue<number | undefined>(config, legacyConfig, 'heading2SizePt', undefined)),
        heading3Font: readConfigValue(config, legacyConfig, 'heading3Font', '').trim(),
        heading3SizePt: normalizePositiveNumber(readConfigValue<number | undefined>(config, legacyConfig, 'heading3SizePt', undefined)),
        lineSpacing: normalizePositiveNumber(readConfigValue<number | undefined>(config, legacyConfig, 'lineSpacing', undefined)),
        marginTopMm: normalizePositiveNumber(readConfigValue<number | undefined>(config, legacyConfig, 'marginTopMm', undefined)),
        marginBottomMm: normalizePositiveNumber(readConfigValue<number | undefined>(config, legacyConfig, 'marginBottomMm', undefined)),
        marginLeftMm: normalizePositiveNumber(readConfigValue<number | undefined>(config, legacyConfig, 'marginLeftMm', undefined)),
        marginRightMm: normalizePositiveNumber(readConfigValue<number | undefined>(config, legacyConfig, 'marginRightMm', undefined))
    };
}

function readConfigValue<T>(
    config: vscode.WorkspaceConfiguration,
    legacyConfig: vscode.WorkspaceConfiguration,
    key: string,
    defaultValue: T
): T {
    const inspected = config.inspect<T>(key);
    const hasNewValue = inspected?.workspaceFolderValue !== undefined
        || inspected?.workspaceValue !== undefined
        || inspected?.globalValue !== undefined;
    if (hasNewValue) {
        return config.get<T>(key, defaultValue);
    }

    return legacyConfig.get<T>(key, defaultValue);
}

function normalizeStyleProfile(value: string | undefined): StyleProfile {
    if (value === 'academic' || value === 'business' || value === 'technical') {
        return value;
    }

    return 'template';
}

function normalizePositiveNumber(value: number | undefined): number | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        return undefined;
    }

    return value;
}

async function resolveOutputPath(markdownUri: vscode.Uri, configuredOutputDirectory: string): Promise<string> {
    const markdownDir = path.dirname(markdownUri.fsPath);
    const markdownStem = path.parse(markdownUri.fsPath).name;

    let targetDir = markdownDir;
    if (configuredOutputDirectory) {
        targetDir = path.isAbsolute(configuredOutputDirectory)
            ? configuredOutputDirectory
            : path.resolve(markdownDir, configuredOutputDirectory);
    }

    await fsp.mkdir(targetDir, { recursive: true });
    return path.join(targetDir, `${markdownStem}.docx`);
}

async function resolveReferenceDocx(
    markdownUri: vscode.Uri,
    configuredReferenceDocx: string,
    referenceLanguage: ReferenceLanguage,
    styleProfile: StyleProfile,
    extensionPath: string
): Promise<string | undefined> {
    const markdownDir = path.dirname(markdownUri.fsPath);
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(markdownUri)?.uri.fsPath;

    if (configuredReferenceDocx) {
        const candidates = [
            configuredReferenceDocx,
            path.resolve(markdownDir, configuredReferenceDocx),
            workspaceFolder ? path.resolve(workspaceFolder, configuredReferenceDocx) : undefined
        ].filter((candidate): candidate is string => Boolean(candidate));

        for (const candidate of candidates) {
            if (await exists(candidate)) {
                return candidate;
            }
        }

        throw new UserFacingError(`Configured reference DOCX was not found: ${configuredReferenceDocx}`);
    }

    const localReferenceDocx = path.join(markdownDir, 'reference.docx');
    if (await exists(localReferenceDocx)) {
        return localReferenceDocx;
    }

    const bundledReferenceDocxCandidates = getBundledReferenceDocxCandidates(extensionPath, referenceLanguage, styleProfile);
    for (const bundledReferenceDocx of bundledReferenceDocxCandidates) {
        if (await exists(bundledReferenceDocx)) {
            return bundledReferenceDocx;
        }
    }

    throw new UserFacingError(`Bundled ${referenceLanguage} reference DOCX was not found: ${bundledReferenceDocxCandidates.join(', ')}`);
}

function normalizeReferenceLanguage(value: string | undefined): ReferenceLanguage {
    return value === 'chinese' ? 'chinese' : 'english';
}

function normalizeReferenceLanguageSetting(value: string | undefined): ReferenceLanguageSetting {
    if (value === 'auto') {
        return 'auto';
    }

    return normalizeReferenceLanguage(value);
}

function resolveReferenceLanguage(markdownText: string, setting: ReferenceLanguageSetting): ReferenceLanguage {
    if (setting === 'english' || setting === 'chinese') {
        return setting;
    }

    return detectMarkdownLanguage(markdownText);
}

function detectMarkdownLanguage(markdownText: string): ReferenceLanguage {
    const sample = markdownText.slice(0, 20000);
    const chineseMatches = sample.match(/[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/g)?.length ?? 0;
    const englishMatches = sample.match(/[A-Za-z]/g)?.length ?? 0;

    // Prefer Chinese template when Chinese text is materially present.
    if (chineseMatches >= 40 || chineseMatches > englishMatches * 0.15) {
        return 'chinese';
    }

    return 'english';
}

function getBundledReferenceDocxCandidates(
    extensionPath: string,
    referenceLanguage: ReferenceLanguage,
    styleProfile: StyleProfile
): string[] {
    const primary = BUNDLED_REFERENCE_DOCX_BY_PROFILE_AND_LANGUAGE[styleProfile][referenceLanguage];
    return [path.join(extensionPath, primary)];
}

async function prepareMarkdown(
    markdownPath: string,
    markdownText: string,
    settings: ExportSettings,
    outputChannel: vscode.OutputChannel
): Promise<PreparedMarkdown> {
    const mermaidMatches = [...markdownText.matchAll(MERMAID_BLOCK_REGEX)];
    if (mermaidMatches.length === 0) {
        outputChannel.appendLine('No Mermaid blocks found.');
        return {
            markdownPath,
            mermaidCount: 0
        };
    }

    const mermaid = await requireMermaidCli(settings.mermaidCliPath, markdownPath);
    outputChannel.appendLine(`Using Mermaid CLI: ${mermaid.command}`);
    outputChannel.appendLine(`Mermaid CLI version: ${mermaid.versionLine}`);

    const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mdocx-converter-'));
    const assetsDir = path.join(tempDir, 'mermaid-assets');
    await fsp.mkdir(assetsDir, { recursive: true });

    let processedMarkdown = '';
    let lastIndex = 0;
    let blockIndex = 0;

    for (const match of mermaidMatches) {
        const fullMatch = match[0];
        const diagramBody = match[1];
        const matchIndex = match.index ?? 0;

        processedMarkdown += markdownText.slice(lastIndex, matchIndex);
        blockIndex += 1;

        const inputPath = path.join(assetsDir, `diagram-${blockIndex}.mmd`);
        const outputPath = path.join(assetsDir, `diagram-${blockIndex}.${settings.mermaidOutputFormat}`);
        await fsp.writeFile(inputPath, diagramBody.trim(), 'utf8');

        outputChannel.appendLine(`Rendering Mermaid diagram ${blockIndex} -> ${path.basename(outputPath)}`);
        await runExecutable(
            mermaid.command,
            [
                '-i',
                inputPath,
                '-o',
                outputPath,
                '-b',
                'transparent'
            ],
            {
                shell: mermaid.useShell,
                cwd: path.dirname(markdownPath)
            }
        );

        const relativeDiagramPath = `./mermaid-assets/${path.basename(outputPath)}`.replace(/\\/g, '/');
        processedMarkdown = ensureTrailingBlankLine(processedMarkdown);
        processedMarkdown += `![Mermaid Diagram ${blockIndex}](${relativeDiagramPath})\n\n`;
        lastIndex = matchIndex + fullMatch.length;
    }

    processedMarkdown += markdownText.slice(lastIndex);

    const preparedMarkdownPath = path.join(tempDir, path.basename(markdownPath));
    await fsp.writeFile(preparedMarkdownPath, processedMarkdown, 'utf8');

    return {
        markdownPath: preparedMarkdownPath,
        tempDir,
        mermaidCount: mermaidMatches.length
    };
}

function ensureTrailingBlankLine(markdownText: string): string {
    if (markdownText.length === 0 || /\n\s*\n$/.test(markdownText)) {
        return markdownText;
    }

    if (/\n$/.test(markdownText)) {
        return `${markdownText}\n`;
    }

    return `${markdownText}\n\n`;
}

async function requirePandoc(configuredPath: string): Promise<ResolvedExecutable> {
    const pandoc = await resolvePandoc(configuredPath);
    if (!pandoc) {
        throw new UserFacingError(`Pandoc was not found. ${getPandocInstallHelp()}`);
    }
    return pandoc;
}

function getPandocInstallHelp(): string {
    if (process.platform === 'win32') {
        return 'Install with "winget install --id JohnMacFarlane.Pandoc" or set mdocxConverter.pandocPath.';
    }

    if (process.platform === 'darwin') {
        return 'Install with "brew install pandoc" or set mdocxConverter.pandocPath.';
    }

    return 'Install from https://pandoc.org/installing.html or set mdocxConverter.pandocPath.';
}

async function resolvePandoc(configuredPath: string): Promise<ResolvedExecutable | undefined> {
    const pandoc = await resolveExecutable(getPandocCandidates(configuredPath), ['--version']);
    return pandoc;
}

async function requireMermaidCli(configuredPath: string, markdownPath: string): Promise<ResolvedExecutable> {
    const mermaid = await resolveMermaidCli(configuredPath, markdownPath);
    if (!mermaid) {
        throw new UserFacingError(
            'Mermaid CLI was not found, but this Markdown file contains mermaid code fences. Install with "npm install -g @mermaid-js/mermaid-cli" or set mdocxConverter.mermaidCliPath.'
        );
    }
    return mermaid;
}

async function resolveMermaidCli(configuredPath: string, markdownPath: string): Promise<ResolvedExecutable | undefined> {
    const mermaid = await resolveExecutable(getMermaidCandidates(configuredPath, markdownPath), ['--version']);
    return mermaid;
}

function getPandocCandidates(configuredPath: string): string[] {
    const candidates = [
        configuredPath,
        'pandoc'
    ];

    if (process.platform === 'win32') {
        const localAppData = process.env.LOCALAPPDATA;
        const programFiles = process.env.ProgramFiles;
        const programFilesX86 = process.env['ProgramFiles(x86)'];

        candidates.push(
            localAppData ? path.join(localAppData, 'Pandoc', 'pandoc.exe') : '',
            localAppData ? path.join(localAppData, 'Microsoft', 'WinGet', 'Links', 'pandoc.exe') : '',
            ...findWingetPandocCandidates(localAppData),
            programFiles ? path.join(programFiles, 'Pandoc', 'pandoc.exe') : '',
            programFilesX86 ? path.join(programFilesX86, 'Pandoc', 'pandoc.exe') : ''
        );
    }

    return uniqueNonEmpty(candidates);
}

function findWingetPandocCandidates(localAppData: string | undefined): string[] {
    if (!localAppData) {
        return [];
    }

    const packagesDir = path.join(localAppData, 'Microsoft', 'WinGet', 'Packages');
    try {
        return fs.readdirSync(packagesDir, { withFileTypes: true })
            .filter((entry) => entry.isDirectory() && entry.name.startsWith('JohnMacFarlane.Pandoc_'))
            .flatMap((entry) => findFilesNamed(path.join(packagesDir, entry.name), 'pandoc.exe'));
    } catch {
        return [];
    }
}

function findFilesNamed(searchRoot: string, fileName: string): string[] {
    const found: string[] = [];
    const stack = [searchRoot];

    while (stack.length > 0) {
        const current = stack.pop();
        if (!current) {
            continue;
        }

        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(current, { withFileTypes: true });
        } catch {
            continue;
        }

        for (const entry of entries) {
            const fullPath = path.join(current, entry.name);
            if (entry.isDirectory()) {
                stack.push(fullPath);
            } else if (entry.isFile() && entry.name.toLowerCase() === fileName.toLowerCase()) {
                found.push(fullPath);
            }
        }
    }

    return found;
}

function getMermaidCandidates(configuredPath: string, markdownPath: string): string[] {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(markdownPath))?.uri.fsPath;
    const commandName = process.platform === 'win32' ? 'mmdc.cmd' : 'mmdc';
    const candidates = [
        configuredPath,
        workspaceFolder ? path.join(workspaceFolder, 'node_modules', '.bin', commandName) : '',
        'mmdc',
        commandName
    ];

    if (process.platform === 'win32') {
        const appData = process.env.APPDATA;
        candidates.push(appData ? path.join(appData, 'npm', 'mmdc.cmd') : '');
    }

    return uniqueNonEmpty(candidates);
}

function uniqueNonEmpty(candidates: string[]): string[] {
    return [...new Set(candidates.map((candidate) => candidate.trim()).filter(Boolean))];
}

async function resolveExecutable(candidates: string[], versionArgs: string[]): Promise<ResolvedExecutable | undefined> {
    const seen = new Set<string>();

    for (const candidate of candidates) {
        const normalized = candidate.trim();
        if (!normalized || seen.has(normalized)) {
            continue;
        }

        seen.add(normalized);

        try {
            const useShell = shouldRunThroughShell(normalized);
            const { stdout, stderr } = await execExecutable(normalized, versionArgs, {
                windowsHide: true,
                shell: useShell
            });

            const versionLine = [stdout, stderr]
                .join('\n')
                .split(/\r?\n/)
                .map((line) => line.trim())
                .find(Boolean) ?? 'version info unavailable';

            return {
                command: normalized,
                versionLine,
                useShell
            };
        } catch {
            // Try the next candidate.
        }
    }

    return undefined;
}

async function runPandoc(options: {
    pandoc: ResolvedExecutable;
    sourceMarkdownPath: string;
    originalMarkdownPath: string;
    outputPath: string;
    referenceDocx?: string;
    settings: ExportSettings;
    tempDir?: string;
    outputChannel: vscode.OutputChannel;
}): Promise<void> {
    const { pandoc, sourceMarkdownPath, originalMarkdownPath, outputPath, referenceDocx, settings, tempDir, outputChannel } = options;
    const resourcePathSeparator = process.platform === 'win32' ? ';' : ':';
    const resourcePathEntries = [
        path.dirname(originalMarkdownPath),
        tempDir
    ].filter((entry): entry is string => Boolean(entry));

    const args = [
        sourceMarkdownPath,
        '--from',
        'gfm+raw_html',
        '--to',
        'docx',
        '--output',
        outputPath,
        '--resource-path',
        resourcePathEntries.join(resourcePathSeparator)
    ];

    if (referenceDocx) {
        args.push('--reference-doc', referenceDocx);
    }

    const metadata = buildPandocMetadata(settings);
    for (const [key, value] of Object.entries(metadata)) {
        args.push('--metadata', `${key}=${value}`);
    }

    if (Object.keys(metadata).length > 0) {
        outputChannel.appendLine(`Style profile: ${settings.styleProfile}`);
        outputChannel.appendLine(`Pandoc metadata overrides: ${Object.entries(metadata).map(([key, value]) => `${key}=${value}`).join(', ')}`);
    }

    outputChannel.appendLine(`Running Pandoc with args: ${args.join(' ')}`);

    try {
        const result = await runExecutable(pandoc.command, args, {
            shell: pandoc.useShell,
            cwd: path.dirname(originalMarkdownPath)
        });

        if (result.stdout.trim()) {
            outputChannel.appendLine(result.stdout.trim());
        }

        if (result.stderr.trim()) {
            outputChannel.appendLine(result.stderr.trim());
        }

        const docxStyleOverrides = buildDocxStyleOverrides(settings);
        if (docxStyleOverrides.length > 0 || hasMarginOverrides(settings)) {
            await applyDocxStyleOverrides(outputPath, settings, docxStyleOverrides);
            outputChannel.appendLine('Applied DOCX style overrides.');
        }
    } catch (error) {
        const message = getProcessErrorMessage(error);
        throw new UserFacingError(message);
    }
}

function buildPandocMetadata(settings: ExportSettings): Record<string, string> {
    const metadata: Record<string, string> = {
        ...STYLE_PROFILE_METADATA[settings.styleProfile]
    };

    if (settings.bodyFont) {
        metadata.mainfont = settings.bodyFont;
        metadata.CJKmainfont = settings.bodyFont;
    }

    if (settings.bodySizePt) {
        metadata.fontsize = `${settings.bodySizePt}pt`;
    }

    if (settings.lineSpacing) {
        metadata.linestretch = String(settings.lineSpacing);
    }

    return Object.fromEntries(Object.entries(metadata).filter(([, value]) => value.trim().length > 0));
}

interface DocxStyleOverride {
    styleId: string;
    aliases?: string[];
    font?: string;
    sizePt?: number;
    lineSpacing?: number;
    color?: string;
    shadingFill?: string;
}

function buildDocxStyleOverrides(settings: ExportSettings): DocxStyleOverride[] {
    const profileDefaults = getProfileDocxDefaults(settings.styleProfile);
    const effectiveColor = settings.styleProfile === 'template' ? undefined : '000000';
    const overrides: DocxStyleOverride[] = [
        {
            styleId: 'Normal',
            aliases: ['a', 'a1', 'Text', 'BodyText', 'Body Text', 'FirstParagraph', 'Compact'],
            font: settings.bodyFont || profileDefaults.bodyFont,
            sizePt: settings.bodySizePt ?? profileDefaults.bodySizePt,
            lineSpacing: settings.lineSpacing ?? profileDefaults.lineSpacing,
            color: effectiveColor
        },
        {
            styleId: 'Heading1',
            aliases: ['1'],
            font: settings.heading1Font || profileDefaults.heading1Font,
            sizePt: settings.heading1SizePt ?? profileDefaults.heading1SizePt,
            color: effectiveColor
        },
        {
            styleId: 'Heading2',
            aliases: ['2', '21'],
            font: settings.heading2Font || profileDefaults.heading2Font,
            sizePt: settings.heading2SizePt ?? profileDefaults.heading2SizePt,
            color: effectiveColor
        },
        {
            styleId: 'Heading3',
            aliases: ['3', '31'],
            font: settings.heading3Font || profileDefaults.heading3Font,
            sizePt: settings.heading3SizePt ?? profileDefaults.heading3SizePt,
            color: effectiveColor
        }
    ];

    if (settings.styleProfile === 'technical') {
        overrides.push(...buildTechnicalCodeStyleOverrides());
    }

    return overrides.filter((override) => hasDocxStyleOverrideValue(override));
}

function buildTechnicalCodeStyleOverrides(): DocxStyleOverride[] {
    return [
        {
            styleId: 'SourceCode',
            aliases: ['Code'],
            font: 'Consolas',
            sizePt: 10,
            lineSpacing: 1.05,
            color: '000000',
            shadingFill: 'F3F4F6'
        },
        {
            styleId: 'VerbatimChar',
            font: 'Consolas',
            sizePt: 10,
            color: '000000'
        }
    ];
}

function hasDocxStyleOverrideValue(override: DocxStyleOverride): boolean {
    return Boolean(
        override.font
        || override.sizePt
        || override.lineSpacing
        || override.color
        || override.shadingFill
    );
}

function getProfileDocxDefaults(styleProfile: StyleProfile): {
    bodyFont?: string;
    bodySizePt?: number;
    heading1Font?: string;
    heading1SizePt?: number;
    heading2Font?: string;
    heading2SizePt?: number;
    heading3Font?: string;
    heading3SizePt?: number;
    lineSpacing?: number;
} {
    if (styleProfile === 'academic') {
        return {
            bodyFont: 'SimSun',
            bodySizePt: 12,
            heading1Font: 'SimHei',
            heading1SizePt: 16,
            heading2Font: 'SimHei',
            heading2SizePt: 14,
            heading3Font: 'SimHei',
            heading3SizePt: 12,
            lineSpacing: 1.5
        };
    }

    if (styleProfile === 'business') {
        return {
            bodyFont: 'Arial',
            bodySizePt: 11,
            heading1Font: 'Arial',
            heading1SizePt: 18,
            heading2Font: 'Arial',
            heading2SizePt: 14,
            heading3Font: 'Arial',
            heading3SizePt: 12,
            lineSpacing: 1.3
        };
    }

    if (styleProfile === 'technical') {
        return {
            bodyFont: 'Arial',
            bodySizePt: 11,
            heading1Font: 'Arial',
            heading1SizePt: 16,
            heading2Font: 'Arial',
            heading2SizePt: 14,
            heading3Font: 'Arial',
            heading3SizePt: 12,
            lineSpacing: 1.25
        };
    }

    return {};
}

async function applyDocxStyleOverrides(
    outputPath: string,
    settings: ExportSettings,
    styleOverrides: DocxStyleOverride[]
): Promise<void> {
    const zip = new AdmZip(outputPath);
    const stylesEntry = zip.getEntry('word/styles.xml');
    if (stylesEntry && styleOverrides.length > 0) {
        let stylesXml = stylesEntry.getData().toString('utf8');
        for (const override of styleOverrides) {
            stylesXml = applyStyleOverrideToPrimaryAndAliases(stylesXml, override);
        }
        zip.updateFile('word/styles.xml', Buffer.from(stylesXml, 'utf8'));
    }

    if (hasMarginOverrides(settings)) {
        const documentEntry = zip.getEntry('word/document.xml');
        if (documentEntry) {
            const documentXml = updateDocumentMargins(documentEntry.getData().toString('utf8'), settings);
            zip.updateFile('word/document.xml', Buffer.from(documentXml, 'utf8'));
        }
    }

    zip.writeZip(outputPath);
}

function applyStyleOverrideToPrimaryAndAliases(stylesXml: string, override: DocxStyleOverride): string {
    let updated = upsertStyleOverride(stylesXml, {
        ...override,
        aliases: undefined
    });

    for (const alias of override.aliases ?? []) {
        updated = upsertStyleOverride(updated, {
            ...override,
            styleId: alias,
            aliases: undefined
        });
    }

    return updated;
}

function upsertStyleOverride(stylesXml: string, override: DocxStyleOverride): string {
    const styleRegex = new RegExp(`<w:style\\b(?=[^>]*w:styleId="${escapeRegex(override.styleId)}")[\\s\\S]*?</w:style>`);
    if (styleRegex.test(stylesXml)) {
        return stylesXml.replace(styleRegex, (styleXml) => updateStyleXml(styleXml, override));
    }

    return insertDocxStyle(stylesXml, override);
}

function insertDocxStyle(stylesXml: string, override: DocxStyleOverride): string {
    const styleType = override.styleId.endsWith('Char') ? 'character' : 'paragraph';
    const styleName = override.styleId.replace(/([a-z])([A-Z])/g, '$1 $2');
    const baseStyleXml = `<w:style w:type="${styleType}" w:customStyle="1" w:styleId="${escapeXmlAttribute(override.styleId)}"><w:name w:val="${escapeXmlAttribute(styleName)}"/></w:style>`;
    const updatedStyleXml = updateStyleXml(baseStyleXml, override);
    return stylesXml.replace(/<\/w:styles>\s*$/, `${updatedStyleXml}</w:styles>`);
}

function updateStyleXml(styleXml: string, override: DocxStyleOverride): string {
    let updated = styleXml;
    updated = ensureChildElement(updated, 'w:rPr');

    if (override.lineSpacing || override.shadingFill) {
        updated = ensureChildElement(updated, 'w:pPr');
    }

    if (override.font) {
        const fontXml = `<w:rFonts w:ascii="${escapeXmlAttribute(override.font)}" w:hAnsi="${escapeXmlAttribute(override.font)}" w:eastAsia="${escapeXmlAttribute(override.font)}" w:cs="${escapeXmlAttribute(override.font)}"/>`;
        updated = upsertInsideElement(updated, 'w:rPr', /<w:rFonts\b[^>]*\/>/, fontXml);
    }

    if (override.sizePt) {
        const halfPoints = String(Math.round(override.sizePt * 2));
        updated = upsertInsideElement(updated, 'w:rPr', /<w:sz\b[^>]*\/>/, `<w:sz w:val="${halfPoints}"/>`);
        updated = upsertInsideElement(updated, 'w:rPr', /<w:szCs\b[^>]*\/>/, `<w:szCs w:val="${halfPoints}"/>`);
    }

    if (override.lineSpacing) {
        const lineTwips = String(Math.round(override.lineSpacing * 240));
        updated = upsertInsideElement(updated, 'w:pPr', /<w:spacing\b[^>]*\/>/, `<w:spacing w:line="${lineTwips}" w:lineRule="auto"/>`);
    }

    if (override.color) {
        updated = upsertInsideElement(updated, 'w:rPr', /<w:color\b[^>]*\/>/, `<w:color w:val="${escapeXmlAttribute(override.color)}"/>`);
    }

    if (override.shadingFill) {
        updated = upsertInsideElement(updated, 'w:pPr', /<w:shd\b[^>]*\/>/, `<w:shd w:val="clear" w:color="auto" w:fill="${escapeXmlAttribute(override.shadingFill)}"/>`);
    }

    return updated;
}

function ensureChildElement(xml: string, tagName: string): string {
    if (new RegExp(`<${tagName}\\b`).test(xml)) {
        return xml;
    }

    return xml.replace(/(<w:style\b[^>]*>)/, `$1<${tagName}/>`);
}

function upsertInsideElement(xml: string, tagName: string, childRegex: RegExp, childXml: string): string {
    const elementRegex = new RegExp(`<${tagName}\\b[^>]*(?:/>|>[\\s\\S]*?</${tagName}>)`);
    return xml.replace(elementRegex, (elementXml) => {
        if (childRegex.test(elementXml)) {
            return elementXml.replace(childRegex, childXml);
        }

        if (elementXml.endsWith('/>')) {
            return elementXml.replace(/\/>$/, `>${childXml}</${tagName}>`);
        }

        return elementXml.replace(new RegExp(`</${tagName}>$`), `${childXml}</${tagName}>`);
    });
}

function hasMarginOverrides(settings: ExportSettings): boolean {
    return Boolean(settings.marginTopMm || settings.marginBottomMm || settings.marginLeftMm || settings.marginRightMm);
}

function updateDocumentMargins(documentXml: string, settings: ExportSettings): string {
    return documentXml.replace(/<w:pgMar\b[^>]*\/>/g, (pgMarXml) => {
        const marginUpdates = [
            { attr: 'w:top', value: settings.marginTopMm },
            { attr: 'w:bottom', value: settings.marginBottomMm },
            { attr: 'w:left', value: settings.marginLeftMm },
            { attr: 'w:right', value: settings.marginRightMm }
        ];

        let updated = pgMarXml;
        for (const margin of marginUpdates) {
            if (margin.value) {
                updated = upsertXmlAttribute(updated, margin.attr, String(mmToTwips(margin.value)));
            }
        }

        return updated;
    });
}

function upsertXmlAttribute(xml: string, attrName: string, value: string): string {
    const attrRegex = new RegExp(`${escapeRegex(attrName)}="[^"]*"`);
    if (attrRegex.test(xml)) {
        return xml.replace(attrRegex, `${attrName}="${escapeXmlAttribute(value)}"`);
    }

    return xml.replace(/\/>$/, ` ${attrName}="${escapeXmlAttribute(value)}"/>`);
}

function mmToTwips(value: number): number {
    return Math.round(value * 56.6929133858);
}

function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeXmlAttribute(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

async function runExecutable(
    command: string,
    args: string[],
    options: {
        cwd?: string;
        shell?: boolean;
    }
): Promise<{ stdout: string; stderr: string; }> {
    return execExecutable(command, args, {
        cwd: options.cwd,
        shell: options.shell,
        windowsHide: true,
        maxBuffer: 16 * 1024 * 1024
    });
}

async function execExecutable(
    command: string,
    args: string[],
    options: {
        cwd?: string;
        shell?: boolean;
        windowsHide?: boolean;
        maxBuffer?: number;
    }
): Promise<{ stdout: string; stderr: string; }> {
    return execFileAsync(command, args, {
        cwd: options.cwd,
        shell: options.shell,
        windowsHide: options.windowsHide,
        maxBuffer: options.maxBuffer ?? 16 * 1024 * 1024
    });
}

function shouldRunThroughShell(command: string): boolean {
    return process.platform === 'win32' && /\.(cmd|bat)$/i.test(command);
}

async function openExportedDocx(outputPath: string, outputChannel: vscode.OutputChannel): Promise<void> {
    if (process.platform === 'win32') {
        try {
            await revealInWindowsExplorer(outputPath);
            return;
        } catch (error) {
            outputChannel.appendLine(`Could not reveal DOCX in Explorer: ${getErrorMessage(error)}`);
        }
    }

    try {
        const opened = await vscode.env.openExternal(vscode.Uri.file(outputPath));
        if (opened) {
            return;
        }

        outputChannel.appendLine('VS Code reported that the DOCX file could not be opened externally.');
    } catch (error) {
        outputChannel.appendLine(`Could not open DOCX automatically: ${getErrorMessage(error)}`);
    }

    void vscode.window.showWarningMessage(`DOCX exported, but it could not be opened automatically: ${outputPath}`);
}

function revealInWindowsExplorer(outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const child = spawn('explorer.exe', ['/select,', outputPath], {
            detached: true,
            stdio: 'ignore',
            windowsHide: true
        });

        child.once('error', reject);
        child.once('spawn', () => {
            child.unref();
            resolve();
        });
    });
}

function logMissingLocalImages(markdownPath: string, markdownText: string, outputChannel: vscode.OutputChannel): void {
    const imageRegex = /!\[[^\]]*]\(([^)]+)\)/g;
    const markdownDir = path.dirname(markdownPath);
    const missingImages = new Set<string>();

    for (const match of markdownText.matchAll(imageRegex)) {
        const rawTarget = match[1].trim().replace(/^<|>$/g, '');
        if (!rawTarget || /^(https?:|data:|file:)/i.test(rawTarget)) {
            continue;
        }

        const imagePath = path.resolve(markdownDir, rawTarget);
        if (!fs.existsSync(imagePath)) {
            missingImages.add(rawTarget);
        }
    }

    for (const missingImage of missingImages) {
        outputChannel.appendLine(`Warning: image not found relative to markdown file: ${missingImage}`);
    }
}

async function exists(targetPath: string): Promise<boolean> {
    try {
        await fsp.access(targetPath, fs.constants.F_OK);
        return true;
    } catch {
        return false;
    }
}

function getProcessErrorMessage(error: unknown): string {
    const defaultMessage = 'Pandoc export failed. Check the output panel for details.';
    if (!isExecFileError(error)) {
        return defaultMessage;
    }

    const details = [error.stdout, error.stderr, error.message]
        .filter((value): value is string => Boolean(value))
        .join('\n');

    if (/Permission denied|Access is denied|EPERM/i.test(details)) {
        return 'The DOCX file could not be written. Close the target DOCX in Word and try again.';
    }

    if (/Cannot decode image|image.*not found|could not fetch resource/i.test(details)) {
        return 'Pandoc could not resolve one or more images. Check the image paths in the Markdown file.';
    }

    if (/Unknown reader|Unknown extension|mermaid/i.test(details)) {
        return 'The Markdown content uses syntax that Pandoc or the Mermaid preprocessing step could not handle. Check the output panel for the exact block.';
    }

    return defaultMessage;
}

function getErrorMessage(error: unknown): string {
    if (error instanceof UserFacingError) {
        return error.message;
    }

    if (error instanceof Error) {
        return error.message;
    }

    return 'Export failed for an unknown reason.';
}

function isExecFileError(error: unknown): error is NodeJS.ErrnoException & { stdout?: string; stderr?: string; } {
    return typeof error === 'object' && error !== null;
}
