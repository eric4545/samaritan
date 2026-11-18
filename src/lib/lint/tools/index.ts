import { AWS } from './aws';
import { DB_ADMIN, DUMPS, MYSQL, MYSQL_TOOLS, PSQL, REDIS } from './databases';
import { GIT } from './git';
import { HELM, KUBECTL, VELERO } from './kubernetes';
import { CONTAINERS, SERVICE, SYSTEMCTL, TERRAFORM } from './services';
import {
  CRONTAB,
  CURL,
  FILE_AND_PROCESS,
  JQ,
  RM,
  SED,
  SET,
  SHELLS,
  SSH,
  WGET,
} from './shell';
import { TMUX } from './tmux';
import type { ToolProfile } from './types';

/** Every built-in tool profile. A team adds to these with `lint.tools`. */
export const BUILTIN_PROFILES: readonly ToolProfile[] = [
  AWS,
  KUBECTL,
  HELM,
  VELERO,
  GIT,
  TMUX,
  PSQL,
  MYSQL,
  MYSQL_TOOLS,
  REDIS,
  DUMPS,
  DB_ADMIN,
  SYSTEMCTL,
  SERVICE,
  TERRAFORM,
  CONTAINERS,
  FILE_AND_PROCESS,
  RM,
  CRONTAB,
  SED,
  SET,
  SHELLS,
  SSH,
  CURL,
  WGET,
  JQ,
];

export type { BinarySpec, ToolProfile, Verb } from './types';
