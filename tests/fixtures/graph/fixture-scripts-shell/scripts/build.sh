#!/bin/bash
set -euo pipefail

source ./helper.sh

build_app() {
  npm run build
}

build_app
dotnet build ./app.csproj