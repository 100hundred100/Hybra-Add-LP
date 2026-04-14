#!/bin/bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
export PATH="$CLAUDE_PROJECT_DIR/node_modules/.bin:$PATH"
exec vite --host
