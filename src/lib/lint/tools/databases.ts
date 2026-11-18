import type { ToolProfile } from './types';

const SQL_WRITES =
  '\\b(insert|update|delete|drop|alter|truncate|create|grant|revoke)\\b';
const SQL_DROPS = '\\b(drop|truncate)\\b';

/** Clients that run SQL given with `-c` (psql) or `-e` (mysql). */
const sqlClient = (
  id: string,
  binaries: string[],
  flag: string,
): ToolProfile => ({
  id,
  binaries,
  mutating: [{ option: flag, matches: SQL_WRITES }],
  deletesData: [{ option: flag, matches: SQL_DROPS }],
});

export const PSQL: ToolProfile = {
  ...sqlClient('psql', ['psql'], '-c'),
  spec: {
    valueOptions: [
      '-c',
      '-d',
      '-h',
      '-U',
      '-p',
      '-f',
      '--command',
      '--dbname',
      '--host',
      '--username',
      '--port',
      '--file',
    ],
  },
};

export const MYSQL: ToolProfile = {
  ...sqlClient('mysql', ['mysql', 'mariadb'], '-e'),
  spec: {
    valueOptions: ['-u', '-h', '-P', '-e', '-D', '--user', '--host'],
    attachedValueOnly: ['-p'],
  },
};

/** The mysql family's admin tools: same option parsing, no SQL. */
export const MYSQL_TOOLS: ToolProfile = {
  id: 'mysql-tools',
  binaries: ['mysqldump', 'mysqladmin'],
  spec: MYSQL.spec,
};

export const MYSQL_FAMILY = new Set([
  ...MYSQL.binaries,
  ...MYSQL_TOOLS.binaries,
]);

export const REDIS: ToolProfile = {
  id: 'redis-cli',
  binaries: ['redis-cli'],
  mutating: [
    {
      anyOperand: [
        'SET',
        'DEL',
        'FLUSHALL',
        'FLUSHDB',
        'EXPIRE',
        'HSET',
        'HDEL',
        'LPUSH',
        'RPUSH',
        'SADD',
        'SREM',
        'ZADD',
        'ZREM',
        'RENAME',
        'CONFIG',
      ],
    },
  ],
};

export const DUMPS: ToolProfile = {
  id: 'dumps',
  binaries: ['pg_dump', 'pg_dumpall', 'mongodump'],
  backup: [''],
};

export const DB_ADMIN: ToolProfile = {
  id: 'db-admin',
  binaries: ['dropdb', 'createdb'],
  mutating: [''],
  deletesData: [{ verb: '' }],
};
