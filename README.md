# language-kuka-krl
KUKA KRL (KUKA Robot Language) support in Visual Studio Code.


## To do
- [ ] Complete implementation of signal matching
- [ ] Review motion commands
- [ ] Review triggers


## Build (compile)

Prerequisites:
- Node.js (LTS recommended)
- Visual Studio Code

Steps:
1) Install dependencies (reproducible via lockfile)
```powershell
npm ci
```

2) One-off compile
```powershell
npm run compile
# or
npx tsc -p .
```
- Output goes to out/ (configured in tsconfig.json)
- Source maps are generated

3) Watch mode (incremental rebuild)
```powershell
npm run watch
```

4) VS Code build task
- Press Ctrl+Shift+B and choose “tsc: build - tsconfig.json”.

5) Run/debug the extension
- Press F5 to launch the Extension Development Host (you can keep npm run watch running).

## Package the extension (.vsix)

1) Ensure dependencies are installed
```powershell
npm ci
```

2) Create the .vsix package (this triggers the vscode:prepublish script → compile)
```powershell
npx vsce package
```
- Produces a file like language-kuka-krl-1.9.0.vsix (version taken from package.json).

3) Install the .vsix locally for testing
```powershell
code --install-extension .\language-kuka-krl-1.9.0.vsix
```

Optional:
- Publish to VS Code Marketplace:
```powershell
npx vsce publish [patch|minor|major]
```
- Publish to Open VSX:
```powershell
npx ovsx publish
```