"use strict";
import * as vscode from "vscode";

export function activate(context: vscode.ExtensionContext) {
    vscode.languages.setLanguageConfiguration("krl", {
        indentationRules: {
            decreaseIndentPattern: new RegExp(
                /^\s*(ENDFOR|ELSE|ENDIF|ENDLOOP|UNTIL.*|ENDWHILE|ENDSWITCH|CASE.*|DEFAULT.*)\s*(;.*)?$/, "i"),
            increaseIndentPattern: new RegExp(
                /^\s*(FOR.*|IF.*|ELSE|LOOP|REPEAT|WHILE.*|SWITCH.*|CASE.*|DEFAULT.*)\s*(;.*)?$/, "i"),
        },
    });

    vscode.languages.registerDocumentSymbolProvider({ language: 'krl' }, new FunctionSymbolProvider());
}

class FunctionSymbolProvider implements vscode.DocumentSymbolProvider {
  public provideDocumentSymbols(document: vscode.TextDocument): vscode.ProviderResult<vscode.SymbolInformation[]> {
    const symbols: vscode.SymbolInformation[] = [];
    
    // Regular expressions for matching KRL functions and methods
    const functionRegexes = [
      { regex: /GLOBAL\s+DEF\s+\w+\s*\(.*\)/g, kind: vscode.SymbolKind.Function, isGlobal: true },   // Global method
      { regex: /GLOBAL\s+DEFFCT\s+\w+\s+\w+\s*\(.*\)/g, kind: vscode.SymbolKind.Function, isGlobal: true }, // Global function
      { regex: /DEF\s+\w+\s*\(.*\)/g, kind: vscode.SymbolKind.Method, isGlobal: false },             // Method
      { regex: /DEFFCT\s+\w+\s+\w+\s*\(.*\)/g, kind: vscode.SymbolKind.Function, isGlobal: false }         // Function        
    ];
    
    const text = document.getText();

    for (const { regex, kind, isGlobal } of functionRegexes) {
      let match;
      while ((match = regex.exec(text))) {
        const matchText = match[0];
        const startPos = document.positionAt(match.index);
        const endPos = document.positionAt(match.index + matchText.length);
        const range = new vscode.Range(startPos, endPos);
        const symbol = new vscode.SymbolInformation(
          matchText,
          isGlobal ? vscode.SymbolKind.Namespace : kind,  // Use Namespace kind for global functions and methods
          isGlobal ? 'Global' : '',
          new vscode.Location(document.uri, range)
        );
        symbols.push(symbol);
      }
    }

    return symbols;
  }
}

export function deactivate() {}
