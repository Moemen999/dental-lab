import { common } from './common';
import { enums } from './enums';
import { errors } from './errors';
import { auth, layout } from './auth';
import { dashboards } from './dashboards';
import { cases } from './cases';
import { batches } from './batches';
import { dentists } from './dentists';
import { employees } from './employees';
import { audit } from './audit';
import { workTypes } from './workTypes';

/** The Arabic dictionary. Arabic is the only UI language. */
export const ar = {
  common,
  enums,
  errors,
  auth,
  layout,
  dashboards,
  cases,
  batches,
  dentists,
  employees,
  audit,
  workTypes,
};

export type Dictionary = typeof ar;
