#!/bin/bash
set -euo pipefail

source ./helper.sh
export DEPLOY_TOKEN=super-secret-deploy-token
API_KEY=TEST_SECRET_PLACEHOLDER

deploy_app() {
  docker compose up -d
}

deploy_app
