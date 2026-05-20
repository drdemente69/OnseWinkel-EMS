// Permission catalogue. Owner always has every permission implicitly; everyone
// else's grants are stored on users.permissions as a JSON object keyed by the
// IDs in `PERMS`.
//
// `read` access for every feature is always granted — we only gate writes.

export const PERMS = [
  { id: 'employees:create',  label: 'Add employees',        group: 'Employees' },
  { id: 'employees:edit',    label: 'Edit employees',       group: 'Employees' },
  { id: 'employees:delete',  label: 'Delete employees',     group: 'Employees' },
  { id: 'attendance:edit',   label: 'Edit attendance',      group: 'Attendance' },
  { id: 'documents:upload',  label: 'Upload documents',     group: 'Documents' },
  { id: 'documents:delete',  label: 'Delete documents',     group: 'Documents' },
  { id: 'payslips:create',   label: 'Generate payslips',    group: 'Payslips' },
  { id: 'payslips:delete',   label: 'Delete payslips',      group: 'Payslips' },
  { id: 'ocr:use',           label: 'Use timesheet OCR',    group: 'OCR' },
  { id: 'settings:edit',     label: 'Edit settings + backup', group: 'Settings' },
];

export const PERM_IDS = PERMS.map(p => p.id);

export function defaultPermissions() {
  // New non-owner users start with nothing gated on — the owner toggles each
  // capability on per profile.
  return Object.fromEntries(PERM_IDS.map(id => [id, false]));
}

export function normalisePermissions(input) {
  const safe = defaultPermissions();
  if (input && typeof input === 'object') {
    for (const id of PERM_IDS) {
      if (input[id] === true) safe[id] = true;
    }
  }
  return safe;
}

export function userCan(user, permId) {
  if (!user) return false;
  if (user.is_owner) return true;
  return user.permissions?.[permId] === true;
}
