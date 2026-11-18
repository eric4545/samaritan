import type { ToolProfile } from './types';

export const SYSTEMCTL: ToolProfile = {
  id: 'systemctl',
  binaries: ['systemctl'],
  mutating: ['start|stop|restart|reload|enable|disable|mask|kill'],
};

export const SERVICE: ToolProfile = {
  id: 'service',
  binaries: ['service'],
  mutating: ['* start|stop|restart|reload'],
};

export const TERRAFORM: ToolProfile = {
  id: 'terraform',
  binaries: ['terraform', 'tofu'],
  mutating: ['apply|destroy|import|taint'],
};

export const CONTAINERS: ToolProfile = {
  id: 'docker',
  binaries: ['docker', 'podman'],
  mutating: ['run|rm|stop|kill|restart|push|rmi'],
};
