#!/bin/bash
set -eu
cd /home/toandev/imou-recorder
rollback_dir=$(cat .rollback-path)
case "$rollback_dir" in /home/toandev/imou-recorder/rollback-*) ;; *) echo 'Invalid rollback directory'; exit 1;; esac
test -f "$rollback_dir/rollback.compose.yaml"
docker compose --env-file .1.env -f compose.debian.yaml config --quiet
crontab -l > "$rollback_dir/crontab-before-cutover.txt"
rollback() {
  echo 'Cutover failed; restoring previous app and Imou cron'
  trap - ERR
  docker compose -p imou-recorder -f "$rollback_dir/rollback.compose.yaml" up -d
  crontab "$rollback_dir/crontab-before-cutover.txt"
}
trap rollback ERR
python3 - <<'PY'
import subprocess,os,signal
from pathlib import Path
script='/home/toandev/backups/scripts/backup_imou.sh'
source='/home/toandev/imou-recorder/data'
remote='gdrive:ASUS_Server_Backup/Imou_Recorder'
cron=subprocess.check_output(['crontab','-l'],text=True)
subprocess.run(['crontab','-'],input='\n'.join(line for line in cron.splitlines() if script not in line)+'\n',text=True,check=True)
for p in Path('/proc').glob('[0-9]*/cmdline'):
 try:
  args=p.read_bytes().decode().split('\0')
  backup=script in args or (len(args)>2 and args[0] in ['/bin/sh','/bin/bash'] and args[1]=='-c' and args[2].startswith(script+' '))
  transfer=len(args)>3 and Path(args[0]).name=='rclone' and args[1:4]==['copy',source,remote]
  if backup or transfer:
   os.kill(int(p.parent.name),signal.SIGTERM); print('Stopped old Imou backup process',p.parent.name)
 except (FileNotFoundError,ProcessLookupError,PermissionError): pass
PY
docker stop --time 60 imou-recorder
cp compose.debian.yaml compose.yaml
docker compose --env-file .1.env up -d
sleep 12
test "$(docker inspect imou-recorder --format '{{.State.Status}}')" = running
test "$(docker inspect imou-recorder --format '{{.RestartCount}}')" = 0
trap - ERR
echo 'Cutover complete; observe logs and deliveries'
docker logs --tail 18 imou-recorder
