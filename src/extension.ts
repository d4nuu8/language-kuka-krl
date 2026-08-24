"use strict";
import * as vscode from "vscode";

const KRL_SELECTOR: vscode.DocumentSelector = { language: "krl" };
const KRL_FILES_GLOB = "**/*.{src,dat,sub}";

const PROC_DECLARATION = /^\s*(?:GLOBAL\s+)?DEF\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/i;
const FUNC_DECLARATION = /^\s*(?:GLOBAL\s+)?DEFFCT\s+\S+\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/i;
const PROC_DECLARATION_WITH_PARAMS = /^\s*(?:GLOBAL\s+)?DEF\s+[A-Za-z_][A-Za-z0-9_]*\s*\((.*?)\)/i;
const FUNC_DECLARATION_WITH_PARAMS = /^\s*(?:GLOBAL\s+)?DEFFCT\s+\S+\s+[A-Za-z_][A-Za-z0-9_]*\s*\((.*?)\)/i;
const VARIABLE_DECLARATION = /^\s*((?:(?:GLOBAL|DECL|CONST)\s+)*)?([A-Za-z_][A-Za-z0-9_$]*)\s+(.+)$/i;
const PROC_END = /^\s*END\b/i;
const FUNC_END = /^\s*ENDFCT\b/i;

const RESERVED_WORDS = new Set<string>([
    "CASE",
    "DEF",
    "DEFDAT",
    "DEFFCT",
    "DEFAULT",
    "ELSE",
    "END",
    "ENDDAT",
    "ENDFCT",
    "ENDFOR",
    "ENDIF",
    "ENDLOOP",
    "ENDSWITCH",
    "ENDWHILE",
    "FOR",
    "GLOBAL",
    "IF",
    "LOOP",
    "REPEAT",
    "RETURN",
    "SWITCH",
    "THEN",
    "UNTIL",
    "WHILE",
]);

type FunctionDefinition = {
    name: string;
    range: vscode.Range;
    selectionRange: vscode.Range;
    location: vscode.Location;
};

type FunctionScope = {
    startLine: number;
    endLine: number;
    parameterText: string;
};

type VariableDefinition = {
    name: string;
    declarationLine: number;
    isGlobal: boolean;
    scopeStartLine?: number;
    scopeEndLine?: number;
    location: vscode.Location;
};

const NON_DECLARATION_TYPES = new Set<string>([
    "BRAKE",
    "CASE",
    "CONTINUE",
    "DEF",
    "DEFDAT",
    "DEFFCT",
    "DEFAULT",
    "ELSE",
    "END",
    "ENDDAT",
    "ENDFCT",
    "ENDIF",
    "ENDLOOP",
    "ENDSWITCH",
    "ENDWHILE",
    "EXIT",
    "FOR",
    "GOTO",
    "HALT",
    "IF",
    "INTERRUPT",
    "LOOP",
    "REPEAT",
    "RESUME",
    "RETURN",
    "SWITCH",
    "TRIGGER",
    "UNTIL",
    "WAIT",
    "WHILE",
]);

function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseDefinitionLine(line: string): string | undefined {
    const procMatch = PROC_DECLARATION.exec(line);
    if (procMatch) {
        return procMatch[1];
    }

    const funcMatch = FUNC_DECLARATION.exec(line);
    if (funcMatch) {
        return funcMatch[1];
    }

    return undefined;
}

function stripComment(line: string): string {
    const commentIndex = line.indexOf(";");
    return commentIndex >= 0 ? line.substring(0, commentIndex) : line;
}

function parseParameterNames(parameterText: string): string[] {
    const names: string[] = [];
    const parts = parameterText.split(",");

    for (const part of parts) {
        const match = /^\s*([A-Za-z_][A-Za-z0-9_$]*)\s*:/.exec(part);
        if (match) {
            names.push(match[1]);
        }
    }

    return names;
}

function extractDeclaredVariableNames(variableListText: string): string[] {
    const names: string[] = [];
    const segments = variableListText.split(",");

    for (const segment of segments) {
        const match = /^\s*([A-Za-z_][A-Za-z0-9_$]*)/.exec(segment);
        if (match) {
            names.push(match[1]);
        }
    }

    return names;
}

function parseFunctionScopes(document: vscode.TextDocument): FunctionScope[] {
    const scopes: FunctionScope[] = [];

    for (let line = 0; line < document.lineCount; line++) {
        const lineText = document.lineAt(line).text;
        const procMatch = PROC_DECLARATION_WITH_PARAMS.exec(lineText);
        const funcMatch = FUNC_DECLARATION_WITH_PARAMS.exec(lineText);

        if (!procMatch && !funcMatch) {
            continue;
        }

        const parameterText = procMatch ? procMatch[1] : (funcMatch ? funcMatch[1] : "");
        const endRegex = funcMatch ? FUNC_END : PROC_END;

        let endLine = line;
        for (let nextLine = line + 1; nextLine < document.lineCount; nextLine++) {
            if (endRegex.test(document.lineAt(nextLine).text)) {
                endLine = nextLine;
                break;
            }
        }

        scopes.push({
            startLine: line,
            endLine,
            parameterText,
        });

        line = endLine;
    }

    return scopes;
}

function findContainingScope(scopes: FunctionScope[], line: number): FunctionScope | undefined {
    return scopes.find((scope) => line >= scope.startLine && line <= scope.endLine);
}

function parseVariableDefinitions(document: vscode.TextDocument): VariableDefinition[] {
    const definitions: VariableDefinition[] = [];
    const scopes = parseFunctionScopes(document);

    for (const scope of scopes) {
        const declarationText = document.lineAt(scope.startLine).text;
        const parameterNames = parseParameterNames(scope.parameterText);

        for (const name of parameterNames) {
            const range = getNameRange(declarationText, scope.startLine, name);
            definitions.push({
                name,
                declarationLine: scope.startLine,
                isGlobal: false,
                scopeStartLine: scope.startLine,
                scopeEndLine: scope.endLine,
                location: new vscode.Location(document.uri, range),
            });
        }
    }

    for (let line = 0; line < document.lineCount; line++) {
        const lineText = document.lineAt(line).text;
        const content = stripComment(lineText);

        if (content.trim().length === 0) {
            continue;
        }

        if (PROC_DECLARATION.test(content) || FUNC_DECLARATION.test(content)) {
            continue;
        }

        if (/^\s*INTERRUPT\s+DECL\b/i.test(content)) {
            continue;
        }

        const declarationMatch = VARIABLE_DECLARATION.exec(content);
        if (!declarationMatch) {
            continue;
        }

        const modifiers = declarationMatch[1] ?? "";
        const typeName = declarationMatch[2].toUpperCase();
        if (NON_DECLARATION_TYPES.has(typeName)) {
            continue;
        }

        const variableList = declarationMatch[3].trim();
        if (variableList.startsWith("[") || variableList.startsWith("=")) {
            continue;
        }

        const names = extractDeclaredVariableNames(variableList);
        if (names.length === 0) {
            continue;
        }

        const containingScope = findContainingScope(scopes, line);
        const isGlobal = /\bGLOBAL\b/i.test(modifiers) || containingScope === undefined;

        for (const name of names) {
            const range = getNameRange(lineText, line, name);
            definitions.push({
                name,
                declarationLine: line,
                isGlobal,
                scopeStartLine: containingScope?.startLine,
                scopeEndLine: containingScope?.endLine,
                location: new vscode.Location(document.uri, range),
            });
        }
    }

    return definitions;
}

function getBestLocalVariableDefinition(
    definitions: VariableDefinition[],
    symbol: string,
    usageLine: number,
): VariableDefinition | undefined {
    const target = symbol.toLowerCase();

    const matches = definitions.filter((definition) => {
        if (definition.name.toLowerCase() !== target) {
            return false;
        }

        if (definition.scopeStartLine === undefined || definition.scopeEndLine === undefined) {
            return false;
        }

        return usageLine >= definition.scopeStartLine
            && usageLine <= definition.scopeEndLine
            && definition.declarationLine <= usageLine;
    });

    if (matches.length === 0) {
        return undefined;
    }

    return matches.reduce((closest, current) => {
        return current.declarationLine > closest.declarationLine ? current : closest;
    });
}

async function findGlobalVariableDefinitionsInWorkspace(symbol: string): Promise<vscode.Location[]> {
    const documents = await getKrlDocuments();
    const target = symbol.toLowerCase();
    const locations: vscode.Location[] = [];

    for (const document of documents) {
        const definitions = parseVariableDefinitions(document);
        for (const definition of definitions) {
            if (definition.isGlobal && definition.name.toLowerCase() === target) {
                locations.push(definition.location);
            }
        }
    }

    return locations;
}

function findIdentifierRanges(
    document: vscode.TextDocument,
    symbol: string,
    startLine = 0,
    endLine = document.lineCount - 1,
): vscode.Range[] {
    const ranges: vscode.Range[] = [];
    const wordRegex = new RegExp(`\\b${escapeRegex(symbol)}\\b`, "ig");

    for (let line = Math.max(0, startLine); line <= Math.min(document.lineCount - 1, endLine); line++) {
        const rawLine = document.lineAt(line).text;
        const content = stripComment(rawLine);

        wordRegex.lastIndex = 0;
        let match = wordRegex.exec(content);
        while (match) {
            ranges.push(new vscode.Range(line, match.index, line, match.index + match[0].length));
            match = wordRegex.exec(content);
        }
    }

    return ranges;
}

function dedupeLocations(locations: vscode.Location[]): vscode.Location[] {
    const seen = new Set<string>();
    const result: vscode.Location[] = [];

    for (const location of locations) {
        const key = `${location.uri.toString()}:${location.range.start.line}:${location.range.start.character}`;
        if (seen.has(key)) {
            continue;
        }

        seen.add(key);
        result.push(location);
    }

    return result;
}

function getNameRange(lineText: string, line: number, name: string): vscode.Range {
    const nameRegex = new RegExp(`\\b${escapeRegex(name)}\\b`, "i");
    const match = nameRegex.exec(lineText);

    if (!match) {
        return new vscode.Range(line, 0, line, 0);
    }

    return new vscode.Range(line, match.index, line, match.index + match[0].length);
}

function parseFunctionDefinitions(document: vscode.TextDocument): FunctionDefinition[] {
    const definitions: FunctionDefinition[] = [];

    for (let line = 0; line < document.lineCount; line++) {
        const lineText = document.lineAt(line).text;
        const name = parseDefinitionLine(lineText);

        if (!name) {
            continue;
        }

        const selectionRange = getNameRange(lineText, line, name);
        const range = document.lineAt(line).range;

        definitions.push({
            name,
            range,
            selectionRange,
            location: new vscode.Location(document.uri, selectionRange),
        });
    }

    return definitions;
}

type BlockPattern = {
    start: RegExp;
    end: RegExp;
    kind: vscode.SymbolKind;
    getName: (lineText: string) => string;
    getSelectionRange?: (lineText: string, line: number) => vscode.Range;
};

type OpenBlock = {
    symbol: vscode.DocumentSymbol;
    end: RegExp;
};

const BLOCK_PATTERNS: BlockPattern[] = [
    {
        start: /^\s*(?:GLOBAL\s+)?DEFFCT\b/i,
        end: /^\s*ENDFCT\b/i,
        kind: vscode.SymbolKind.Function,
        getName: (lineText) => parseDefinitionLine(lineText) ?? "DEFFCT",
        getSelectionRange: (lineText, line) => {
            const name = parseDefinitionLine(lineText) ?? "DEFFCT";
            return getNameRange(lineText, line, name);
        },
    },
    {
        start: /^\s*(?:GLOBAL\s+)?DEF\b/i,
        end: /^\s*END\b/i,
        kind: vscode.SymbolKind.Function,
        getName: (lineText) => parseDefinitionLine(lineText) ?? "DEF",
        getSelectionRange: (lineText, line) => {
            const name = parseDefinitionLine(lineText) ?? "DEF";
            return getNameRange(lineText, line, name);
        },
    },
    {
        start: /^\s*IF\b/i,
        end: /^\s*ENDIF\b/i,
        kind: vscode.SymbolKind.Namespace,
        getName: (lineText) => stripComment(lineText).trim(),
    },
    {
        start: /^\s*FOR\b/i,
        end: /^\s*ENDFOR\b/i,
        kind: vscode.SymbolKind.Namespace,
        getName: (lineText) => stripComment(lineText).trim(),
    },
    {
        start: /^\s*LOOP\b/i,
        end: /^\s*ENDLOOP\b/i,
        kind: vscode.SymbolKind.Namespace,
        getName: (lineText) => stripComment(lineText).trim(),
    },
    {
        start: /^\s*REPEAT\b/i,
        end: /^\s*UNTIL\b/i,
        kind: vscode.SymbolKind.Namespace,
        getName: (lineText) => stripComment(lineText).trim(),
    },
    {
        start: /^\s*WHILE\b/i,
        end: /^\s*ENDWHILE\b/i,
        kind: vscode.SymbolKind.Namespace,
        getName: (lineText) => stripComment(lineText).trim(),
    },
    {
        start: /^\s*SWITCH\b/i,
        end: /^\s*ENDSWITCH\b/i,
        kind: vscode.SymbolKind.Namespace,
        getName: (lineText) => stripComment(lineText).trim(),
    },
];

function closeMatchingBlock(
    stack: OpenBlock[],
    lineText: string,
    line: number,
): boolean {
    for (let index = stack.length - 1; index >= 0; index--) {
        if (!stack[index].end.test(lineText)) {
            continue;
        }

        const [closedBlock] = stack.splice(index, 1);
        closedBlock.symbol.range = new vscode.Range(
            closedBlock.symbol.range.start,
            documentLineEnd(lineText, line),
        );
        return true;
    }

    return false;
}

function documentLineEnd(lineText: string, line: number): vscode.Position {
    return new vscode.Position(line, lineText.length);
}

function parseDocumentSymbols(document: vscode.TextDocument): vscode.DocumentSymbol[] {
    const roots: vscode.DocumentSymbol[] = [];
    const stack: OpenBlock[] = [];

    for (let line = 0; line < document.lineCount; line++) {
        const rawLineText = document.lineAt(line).text;
        const lineText = stripComment(rawLineText);
        if (lineText.trim().length === 0) {
            continue;
        }

        closeMatchingBlock(stack, lineText, line);

        const blockPattern = BLOCK_PATTERNS.find((pattern) => pattern.start.test(lineText));
        if (!blockPattern) {
            continue;
        }

        const symbolRange = new vscode.Range(line, 0, line, rawLineText.length);
        const selectionRange = blockPattern.getSelectionRange?.(rawLineText, line)
            ?? symbolRange;
        const symbol = new vscode.DocumentSymbol(
            blockPattern.getName(rawLineText),
            "KRL",
            blockPattern.kind,
            symbolRange,
            selectionRange,
        );

        if (stack.length === 0) {
            roots.push(symbol);
        } else {
            stack[stack.length - 1].symbol.children.push(symbol);
        }

        stack.push({
            symbol,
            end: blockPattern.end,
        });
    }

    const lastLine = Math.max(document.lineCount - 1, 0);
    const lastLineText = document.lineAt(lastLine).text;
    while (stack.length > 0) {
        const openBlock = stack.pop();
        if (!openBlock) {
            continue;
        }

        openBlock.symbol.range = new vscode.Range(
            openBlock.symbol.range.start,
            documentLineEnd(lastLineText, lastLine),
        );
    }

    return roots;
}

async function getKrlDocuments(): Promise<vscode.TextDocument[]> {
    const docsByUri = new Map<string, vscode.TextDocument>();

    for (const document of vscode.workspace.textDocuments) {
        if (document.languageId === "krl") {
            docsByUri.set(document.uri.toString(), document);
        }
    }

    const uris = await vscode.workspace.findFiles(KRL_FILES_GLOB, "**/node_modules/**");
    for (const uri of uris) {
        const document = await vscode.workspace.openTextDocument(uri);
        docsByUri.set(document.uri.toString(), document);
    }

    return Array.from(docsByUri.values());
}

function getSymbolAtPosition(document: vscode.TextDocument, position: vscode.Position): string | undefined {
    const wordRange = document.getWordRangeAtPosition(position, /[A-Za-z_$][A-Za-z0-9_$]*/);
    if (!wordRange) {
        return undefined;
    }

    const word = document.getText(wordRange);
    if (RESERVED_WORDS.has(word.toUpperCase())) {
        return undefined;
    }

    return word;
}

async function findDefinitionsInWorkspace(symbol: string): Promise<vscode.Location[]> {
    const documents = await getKrlDocuments();
    const target = symbol.toLowerCase();
    const locations: vscode.Location[] = [];

    for (const document of documents) {
        for (const definition of parseFunctionDefinitions(document)) {
            if (definition.name.toLowerCase() === target) {
                locations.push(definition.location);
            }
        }
    }

    return locations;
}

function findCallRanges(document: vscode.TextDocument, symbol: string): vscode.Range[] {
    const ranges: vscode.Range[] = [];
    const callRegex = new RegExp(`\\b${escapeRegex(symbol)}\\b\\s*\\(`, "ig");

    for (let line = 0; line < document.lineCount; line++) {
        const lineText = document.lineAt(line).text;

        // Avoid returning declaration lines as usages.
        const declarationName = parseDefinitionLine(lineText);

        callRegex.lastIndex = 0;
        let match = callRegex.exec(lineText);
        while (match) {
            const matchedName = match[0].replace(/\s*\($/, "");
            const isDeclaration = declarationName !== undefined
                && declarationName.toLowerCase() === matchedName.toLowerCase();

            if (!isDeclaration) {
                ranges.push(new vscode.Range(line, match.index, line, match.index + matchedName.length));
            }

            match = callRegex.exec(lineText);
        }
    }

    return ranges;
}

class KrlDocumentSymbolProvider implements vscode.DocumentSymbolProvider {
    public provideDocumentSymbols(document: vscode.TextDocument): vscode.DocumentSymbol[] {
        return parseDocumentSymbols(document);
    }
}

class KrlDefinitionProvider implements vscode.DefinitionProvider {
    public async provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position,
    ): Promise<vscode.Definition | undefined> {
        const symbol = getSymbolAtPosition(document, position);
        if (!symbol) {
            return undefined;
        }

        const variableDefinitions = parseVariableDefinitions(document);
        const bestLocalVariable = getBestLocalVariableDefinition(variableDefinitions, symbol, position.line);
        if (bestLocalVariable) {
            return bestLocalVariable.location;
        }

        const globalDefinitionsInWorkspace = await findGlobalVariableDefinitionsInWorkspace(symbol);
        if (globalDefinitionsInWorkspace.length > 0) {
            return globalDefinitionsInWorkspace.length === 1
                ? globalDefinitionsInWorkspace[0]
                : globalDefinitionsInWorkspace;
        }

        const definitions = await findDefinitionsInWorkspace(symbol);
        if (definitions.length === 0) {
            return undefined;
        }

        return definitions.length === 1 ? definitions[0] : definitions;
    }
}

class KrlReferenceProvider implements vscode.ReferenceProvider {
    public async provideReferences(
        document: vscode.TextDocument,
        position: vscode.Position,
        context: vscode.ReferenceContext,
    ): Promise<vscode.Location[]> {
        const symbol = getSymbolAtPosition(document, position);
        if (!symbol) {
            return [];
        }

        const variableDefinitionsInDocument = parseVariableDefinitions(document);
        const bestLocalVariable = getBestLocalVariableDefinition(variableDefinitionsInDocument, symbol, position.line);
        if (bestLocalVariable) {
            const localReferences: vscode.Location[] = [];
            const scopeStart = bestLocalVariable.scopeStartLine ?? 0;
            const scopeEnd = bestLocalVariable.scopeEndLine ?? (document.lineCount - 1);

            const localRanges = findIdentifierRanges(document, symbol, scopeStart, scopeEnd);
            for (const range of localRanges) {
                const isDeclaration = range.start.line === bestLocalVariable.declarationLine
                    && range.start.character === bestLocalVariable.location.range.start.character;

                if (!context.includeDeclaration && isDeclaration) {
                    continue;
                }

                localReferences.push(new vscode.Location(document.uri, range));
            }

            return dedupeLocations(localReferences);
        }

        const globalVariableDefinitions = await findGlobalVariableDefinitionsInWorkspace(symbol);
        if (globalVariableDefinitions.length > 0) {
            const documents = await getKrlDocuments();
            const globalReferences: vscode.Location[] = [];

            const declarationKeys = new Set<string>();
            for (const location of globalVariableDefinitions) {
                declarationKeys.add(`${location.uri.toString()}:${location.range.start.line}:${location.range.start.character}`);
            }

            if (context.includeDeclaration) {
                globalReferences.push(...globalVariableDefinitions);
            }

            for (const textDocument of documents) {
                const ranges = findIdentifierRanges(textDocument, symbol);
                for (const range of ranges) {
                    const key = `${textDocument.uri.toString()}:${range.start.line}:${range.start.character}`;
                    if (!context.includeDeclaration && declarationKeys.has(key)) {
                        continue;
                    }

                    globalReferences.push(new vscode.Location(textDocument.uri, range));
                }
            }

            return dedupeLocations(globalReferences);
        }

        const documents = await getKrlDocuments();
        const references: vscode.Location[] = [];

        const definitions = await findDefinitionsInWorkspace(symbol);
        if (context.includeDeclaration) {
            references.push(...definitions);
        }

        for (const textDocument of documents) {
            const callRanges = findCallRanges(textDocument, symbol);
            for (const range of callRanges) {
                references.push(new vscode.Location(textDocument.uri, range));
            }
        }

        return dedupeLocations(references);
    }
}

class KrlFoldingRangeProvider implements vscode.FoldingRangeProvider {
    public provideFoldingRanges(document: vscode.TextDocument): vscode.FoldingRange[] {
        const ranges: vscode.FoldingRange[] = [];

        // Patterns for control structures
        const controlStructures: Array<{
            start: RegExp;
            end: RegExp;
        }> = [
            { start: /^\s*IF\b/i, end: /^\s*ENDIF\b/i },
            { start: /^\s*LOOP\b/i, end: /^\s*ENDLOOP\b/i },
            { start: /^\s*REPEAT\b/i, end: /^\s*UNTIL\b/i },
            { start: /^\s*WHILE\b/i, end: /^\s*ENDWHILE\b/i },
            { start: /^\s*SWITCH\b/i, end: /^\s*ENDSWITCH\b/i },
            { start: /^\s*FOR\b/i, end: /^\s*ENDFOR\b/i },
            { start: /^\s*(?:GLOBAL\s+)?DEFFCT\b/i, end: /^\s*ENDFCT\b/i },
            { start: /^\s*(?:GLOBAL\s+)?DEF\b/i, end: /^\s*END\b/i },
        ];

        const stack: Array<{ start: number; pattern: RegExp }> = [];

        for (let line = 0; line < document.lineCount; line++) {
            const lineText = document.lineAt(line).text;

            // Check for end patterns
            for (let i = stack.length - 1; i >= 0; i--) {
                if (stack[i].pattern.test(lineText)) {
                    const { start } = stack.pop()!;
                    if (line > start) {
                        ranges.push(new vscode.FoldingRange(start, line));
                    }
                    break;
                }
            }

            // Check for start patterns
            for (const structure of controlStructures) {
                if (structure.start.test(lineText)) {
                    stack.push({ start: line, pattern: structure.end });
                    break;
                }
            }
        }

        return ranges;
    }
}

export function activate(context: vscode.ExtensionContext) {
    vscode.languages.setLanguageConfiguration("krl", {
        indentationRules: {
            decreaseIndentPattern: new RegExp(
                /^\s*(ENDFOR|ELSE|ENDIF|ENDLOOP|UNTIL.*|ENDWHILE|ENDSWITCH|CASE.*|DEFAULT.*)\s*(;.*)?$/, "i"),
            increaseIndentPattern: new RegExp(
                /^\s*(FOR.*|IF.*|ELSE|LOOP|REPEAT|WHILE.*|SWITCH.*|CASE.*|DEFAULT.*)\s*(;.*)?$/, "i"),
        },
    });

    context.subscriptions.push(
        vscode.languages.registerDocumentSymbolProvider(KRL_SELECTOR, new KrlDocumentSymbolProvider()),
        vscode.languages.registerDefinitionProvider(KRL_SELECTOR, new KrlDefinitionProvider()),
        vscode.languages.registerReferenceProvider(KRL_SELECTOR, new KrlReferenceProvider()),
        vscode.languages.registerFoldingRangeProvider(KRL_SELECTOR, new KrlFoldingRangeProvider()),
    );
}
