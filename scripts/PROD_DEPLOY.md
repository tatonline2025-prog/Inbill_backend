# Backend Production Deploy

This backend currently deploys from the branch:

- `migration/allbill-backend-base`

Expected production repo path on the VPS:

- `/root/Inbill_backend_prod`

Required files on the VPS:

- `.env`
- `docker-compose.yml`

Default deploy command on the VPS:

```bash
/usr/local/bin/inbill-backend-deploy
```

The wrapper should call:

```bash
APP_DIR=/root/Inbill_backend_prod \
DEPLOY_BRANCH=migration/allbill-backend-base \
COMPOSE_PROJECT_NAME=inbill_backend \
bash /root/Inbill_backend_prod/scripts/deploy.sh
```

Notes:

- `docker compose` rebuilds the running backend container in place.
- The script uses `git fetch` + `git reset --hard` to make production match GitHub exactly.
- Keep `.env` only on the VPS; do not commit it to GitHub.
