import { action as add } from "./add";
import { action as backup } from "./backup";
import { action as changePassword } from "./change-password";
import { action as clone } from "./clone";
import { action as diff } from "./diff";
import { action as doctor } from "./doctor";
import { action as edit } from "./edit";
import { action as exportAction } from "./export";
import { action as importAction } from "./import";
import { action as list } from "./list";
import { action as logout } from "./logout";
import { action as register } from "./register";
import { action as remove } from "./remove";
import { action as restore } from "./restore";
import { action as rollback } from "./rollback";
import { action as view } from "./view";
import { action as sync } from "./sync";

import { action as dropEnv } from "./drop/env";
import { action as dropProject } from "./drop/project";

import { action as historyLimit } from "./history/limit";
import { action as historyView } from "./history/view";

import { action as switchEnv } from "./switch/env";
import { action as switchProject } from "./switch/project";

import { action as tokenCreate } from "./token/create";
import { action as tokenList } from "./token/list";
import { action as tokenRevoke } from "./token/revoke";

export const commandActions: Record<string, (...args: any[]) => Promise<void>> = {
  add,
  backup,
  "change-password": changePassword,
  clone,
  diff,
  doctor,
  edit,
  export: exportAction,
  import: importAction,
  list,
  logout,
  register,
  remove,
  restore,
  rollback,
  view,
  sync,
  "drop:env": dropEnv,
  "drop:project": dropProject,
  "history:view": historyView,
  "history:limit": historyLimit,
  "switch:env": switchEnv,
  "switch:project": switchProject,
  "token:create": tokenCreate,
  "token:list": tokenList,
  "token:revoke": tokenRevoke,
};
