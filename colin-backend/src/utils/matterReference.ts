/** Transactional matters use parties when they have no court case number. */
export const hasCaseNumber = (value: unknown) => {
  const text = String(value ?? '').trim();
  return Boolean(text) && !/^(?:n\s*\/?\s*a|n\.a\.|not applicable|none|null|undefined|[-_]+)$/i.test(text);
};

export const matterReference = (matter: any): string => hasCaseNumber(matter?.caseNo)
  ? String(matter.caseNo).trim()
  : String(matter?.parties || matter?.clientName || '').trim();
