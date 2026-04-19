import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { promises as fsp } from 'fs';
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const OUTPUT_CHANNEL_NAME = 'paperify-md';
const EXPORT_COMMAND_ID = 'paperifyMd.exportToDocx';
const CHECK_ENVIRONMENT_COMMAND_ID = 'paperifyMd.checkEnvironment';
const MERMAID_BLOCK_REGEX = /```mermaid[^\n]*\r?\n([\s\S]*?)```/gi;
const BUNDLED_REFERENCE_DOCX_BY_LANGUAGE: Record<ReferenceLanguage, string> = {
    english: path.join('journal-templates', 'reference_english_csci.docx'),
    chinese: path.join('journal-templates', 'reference_cssci_三刊通用.docx')
};

type ReferenceLanguage = 'english' | 'chinese';
type ReferenceLanguageSetting = ReferenceLanguage | 'auto';

interface ExportSettings {
    pandocPath: string;
    mermaidCliPath: string;
    referenceDocx: string;
    referenceLanguage: ReferenceLanguageSetting;
    outputDirectory: string;
    mermaidOutputFormat: 'png' | 'svg';
    openAfterExport: boolean;
    keepIntermediateFiles: boolean;
}

interface ResolvedExecutable {
    command: string;
    versionLine: string;
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
    const checkEnvironmentDisposable = vscode.commands.registerCommand(CHECK_ENVIRONMENT_COMMAND_ID, async (uri?: vscode.Uri) => {
        await checkEnvironment(uri, outputChannel);
    });

    context.subscriptions.push(exportDisposable, checkEnvironmentDisposable);
}

export function deactivate(): void {
    // No-op.
}

async function runExport(uri: vscode.Uri | undefined, outputChannel: vscode.OutputChannel, extensionPath: string): Promise<void> {
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
        const settings = readSettings(markdownUri);
        const outputPath = await resolveOutputPath(markdownUri, settings.outputDirectory);
        const markdownText = await fsp.readFile(markdownUri.fsPath, 'utf8');
        const resolvedLanguage = resolveReferenceLanguage(markdownText, settings.referenceLanguage);
        const referenceDocx = await resolveReferenceDocx(markdownUri, settings.referenceDocx, resolvedLanguage, extensionPath);

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
            const settings = readSettings(markdownUri);
            if (!settings.keepIntermediateFiles) {
                await fsp.rm(prepared.tempDir, { recursive: true, force: true });
            } else {
                outputChannel.appendLine(`Kept intermediate files in: ${prepared.tempDir}`);
            }
        }
    }
}

async function checkEnvironment(uri: vscode.Uri | undefined, outputChannel: vscode.OutputChannel): Promise<void> {
    const markdownUri = getMarkdownUri(uri) ?? vscode.Uri.file(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd());
    const settings = readSettings(markdownUri);

    outputChannel.clear();
    outputChannel.show(true);
    outputChannel.appendLine('Checking paperify-md export environment...');

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
        outputChannel.appendLine('   Or set paperifyMd.mermaidCliPath.');
    }

    if (pandoc && mermaid) {
        void vscode.window.showInformationMessage('paperify-md export environment looks ready.');
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

function readSettings(markdownUri: vscode.Uri): ExportSettings {
    const config = vscode.workspace.getConfiguration('paperifyMd', markdownUri);
    return {
        pandocPath: config.get<string>('pandocPath', 'pandoc').trim() || 'pandoc',
        mermaidCliPath: config.get<string>('mermaidCliPath', 'mmdc').trim() || 'mmdc',
        referenceDocx: config.get<string>('referenceDocx', '').trim(),
        referenceLanguage: normalizeReferenceLanguageSetting(config.get<string>('referenceLanguage', 'auto')),
        outputDirectory: config.get<string>('outputDirectory', '').trim(),
        mermaidOutputFormat: config.get<'png' | 'svg'>('mermaidOutputFormat', 'png'),
        openAfterExport: config.get<boolean>('openAfterExport', false),
        keepIntermediateFiles: config.get<boolean>('keepIntermediateFiles', false)
    };
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

    const bundledReferenceDocx = getBundledReferenceDocx(extensionPath, referenceLanguage);
    if (await exists(bundledReferenceDocx)) {
        return bundledReferenceDocx;
    }

    throw new UserFacingError(`Bundled ${referenceLanguage} reference DOCX was not found: ${bundledReferenceDocx}`);
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

function getBundledReferenceDocx(extensionPath: string, referenceLanguage: ReferenceLanguage): string {
    return path.join(extensionPath, BUNDLED_REFERENCE_DOCX_BY_LANGUAGE[referenceLanguage]);
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

    const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'paperify-md-'));
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
                cwd: path.dirname(markdownPath)
            }
        );

        const relativeDiagramPath = `./mermaid-assets/${path.basename(outputPath)}`.replace(/\\/g, '/');
        processedMarkdown += `![Mermaid Diagram ${blockIndex}](${relativeDiagramPath})`;
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

async function requirePandoc(configuredPath: string): Promise<ResolvedExecutable> {
    const pandoc = await resolvePandoc(configuredPath);
    if (!pandoc) {
        throw new UserFacingError(`Pandoc was not found. ${getPandocInstallHelp()}`);
    }
    return pandoc;
}

function getPandocInstallHelp(): string {
    if (process.platform === 'win32') {
        return 'Install with "winget install --id JohnMacFarlane.Pandoc" or set paperifyMd.pandocPath.';
    }

    if (process.platform === 'darwin') {
        return 'Install with "brew install pandoc" or set paperifyMd.pandocPath.';
    }

    return 'Install from https://pandoc.org/installing.html or set paperifyMd.pandocPath.';
}

async function resolvePandoc(configuredPath: string): Promise<ResolvedExecutable | undefined> {
    const pandoc = await resolveExecutable(getPandocCandidates(configuredPath), ['--version']);
    return pandoc;
}

async function requireMermaidCli(configuredPath: string, markdownPath: string): Promise<ResolvedExecutable> {
    const mermaid = await resolveMermaidCli(configuredPath, markdownPath);
    if (!mermaid) {
        throw new UserFacingError(
            'Mermaid CLI was not found, but this Markdown file contains mermaid code fences. Install with "npm install -g @mermaid-js/mermaid-cli" or set paperifyMd.mermaidCliPath.'
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
            const { stdout, stderr } = await execFileAsync(normalized, versionArgs, {
                windowsHide: true
            });

            const versionLine = [stdout, stderr]
                .join('\n')
                .split(/\r?\n/)
                .map((line) => line.trim())
                .find(Boolean) ?? 'version info unavailable';

            return {
                command: normalized,
                versionLine
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
    tempDir?: string;
    outputChannel: vscode.OutputChannel;
}): Promise<void> {
    const { pandoc, sourceMarkdownPath, originalMarkdownPath, outputPath, referenceDocx, tempDir, outputChannel } = options;
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

    outputChannel.appendLine(`Running Pandoc with args: ${args.join(' ')}`);

    try {
        const result = await runExecutable(pandoc.command, args, {
            cwd: path.dirname(originalMarkdownPath)
        });

        if (result.stdout.trim()) {
            outputChannel.appendLine(result.stdout.trim());
        }

        if (result.stderr.trim()) {
            outputChannel.appendLine(result.stderr.trim());
        }
    } catch (error) {
        const message = getProcessErrorMessage(error);
        throw new UserFacingError(message);
    }
}

async function runExecutable(
    command: string,
    args: string[],
    options: {
        cwd?: string;
    }
): Promise<{ stdout: string; stderr: string; }> {
    return execFileAsync(command, args, {
        cwd: options.cwd,
        windowsHide: true,
        maxBuffer: 16 * 1024 * 1024
    });
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
