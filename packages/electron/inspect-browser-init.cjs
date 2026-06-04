const source = process.binding('natives')['electron/js2c/browser_init'];
for (const term of ['ipcMain', 'electron_browser_window', 'electron_browser_dialog', 'electron_browser_app', 'web-contents', 'exports/electron.ts']) {
  const index = source.indexOf(term);
  console.log('TERM', term, 'INDEX', index);
  if (index >= 0) {
    console.log(source.slice(Math.max(0, index - 400), Math.min(source.length, index + 1200)));
    console.log('\n---\n');
  }
}
