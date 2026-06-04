require('fs').writeFileSync('C:\\\\Users\\\\yashm\\\\Desktop\\\\openagentgraph\\\\packages\\\\electron\\\\probe-app\\\\combo.txt', 'start\n');
process._linkedBinding('electron_common_command_line');
require('fs').appendFileSync('C:\\\\Users\\\\yashm\\\\Desktop\\\\openagentgraph\\\\packages\\\\electron\\\\probe-app\\\\combo.txt', 'common\n');
process._linkedBinding('electron_browser_app');
require('fs').appendFileSync('C:\\\\Users\\\\yashm\\\\Desktop\\\\openagentgraph\\\\packages\\\\electron\\\\probe-app\\\\combo.txt', 'app\n');
process.exit(0);
