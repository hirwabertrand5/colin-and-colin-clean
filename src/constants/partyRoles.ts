// Consolidated party role taxonomy and suggestions

export const FULL_PARTY_ROLES = [
  // GENERAL / CORE PARTIES
  'Natural Person',
  'Client',
  'Witness',
  'Expert Witness',
  'Consultant',
  'Interpreter',
  'Representative',
  'Agent',
  'Guardian',
  'Curator',
  'Executor',
  'Beneficiary',

  // Legal Entities
  'Company',
  'Partnership',
  'Sole Proprietor',
  'Joint Venture',
  'Trust',
  'Foundation',
  'Association',
  'Nonprofit / NGO',
  'Cooperative',
  'Government Department',
  'Municipality',
  'State-Owned Enterprise',
  'Regulatory Authority',

  // Legal Professionals
  'Advocate',
  'Counsel',
  'Prosecutor',
  'Notary',
  'Arbitrator',
  'Mediator',
  'Conciliator',
  'Liquidator',
  'Trustee',

  // CIVIL LITIGATION
  'Claimant',
  'Respondent',
  'Appellant',
  'Intervenor',
  'Interested Party',
  'Amicus Curiae',
  'Garnishee',
  'Receiver',

  // CRIMINAL LAW
  'Prosecution',
  'Accused',
  'Defendant',
  'Co-Accused',
  'Suspect',
  'Complainant',
  'Victim',
  'Surety',
  'Juvenile',

  // COMMERCIAL / CORPORATE
  'Shareholder',
  'Director',
  'Company Secretary',
  'Member',
  'Partner',
  'Managing Partner',
  'Trustee (Corporate)',
  'Creditor',
  'Debtor',
  'Guarantor',
  'Surety',

  // FAMILY LAW
  'Husband',
  'Wife',
  'Spouse',
  'Former Spouse',
  'Applicant',
  'Respondent (Family)',
  'Parent',
  'Biological Parent',
  'Adoptive Parent',
  'Child',
  'Minor',
  'Guardian (Family)',
  'Custodian',
  'Maintenance Debtor',
  'Maintenance Creditor',
  'Dependent',

  // LABOUR / EMPLOYMENT
  'Employer',
  'Employee',
  'Intern',
  'Trade Union',

  // ADMINISTRATIVE / REGULATORY
  'Administrative Authority',
  'Tribunal',
  'Inspector',
  'Compliance Officer',
  'Tax Authority',
  'Applicant (Admin)',
  'Respondent (Admin)',

  // PROPERTY / REAL ESTATE
  'Seller',
  'Purchaser',
  'Buyer',
  'Owner',
  'Tenant',
  'Lessee',
  'Lessor',
  'Landlord',
  'Mortgagee',
  'Mortgagor',
  'Bank',

  // BANKING & FINANCE
  'Borrower',
  'Lender',
  'Debenture Holder',
  'Issuer',
  'Pledgor',

  // M&A
  'Acquirer',
  'Target Company',
  'Seller (M&A)',
  'Purchaser (M&A)',
  'Minority Shareholder',
  'Majority Shareholder',

  // INSOLVENCY / RESTRUCTURING
  'Debtor (Insolvency)',
  'Creditor (Insolvency)',
  'Secured Creditor',
  'Unsecured Creditor',
  'Liquidator',
  'Receiver (Insolvency)',
  'Administrator',

  // INTELLECTUAL PROPERTY
  'Inventor',
  'Author',
  'Patent Holder',
  'Copyright Owner',
  'Assignee',
  'Assignor',
  'Licensor',
  'Licensee',

  // TAX
  'Taxpayer',
  'Revenue Authority',
  'Declarant',
  'Auditor',

  // CONSTRUCTION
  'Main Contractor',
  'Subcontractor',
  'Architect',
  'Engineer',
  'Quantity Surveyor',
  'Project Manager',
  'Supplier',

  // INSURANCE
  'Insurer',
  'Reinsurer',
  'Insured',
  'Policyholder',
  'Broker',

  // HEALTHCARE
  'Patient',
  'Doctor',
  'Surgeon',
  'Hospital',
  'Nurse',

  // ESTATES / TRUSTS
  'Deceased',
  'Executor',
  'Administrator (Estate)',
  'Heir',
  'Testator',
  'Legatee',

  // ARBITRATION / ADR
  'Arbitration Claimant',
  'Arbitration Respondent',
  'Arbitrator',
  'Mediator',

  // PROCUREMENT / PUBLIC TENDERS
  'Procuring Authority',
  'Bidder',
  'Tenderer',
  'Supplier (Tender)',
  'Contractor (Tender)',

  // TECHNOLOGY / DATA / PRIVACY
  'Data Subject',
  'Data Controller',
  'Data Processor',

  // ENERGY / MINING
  'License Holder',
  'Operator',
  'Environmental Authority',
  'Landowner',

  // SHIPPING / LOGISTICS
  'Ship Owner',
  'Charterer',
  'Cargo Owner',
  'Carrier',
  'Port Authority',

  // TRANSACTION-SPECIFIC
  'Seller (SPA)',
  'Purchaser (SPA)',
  'Guarantor (Loan)',
  'Debtor (Loan)',
  'Creditor (Loan)',
  'Lessor (Lease)',
  'Lessee (Lease)',
  'Licensor (License)',
  'Licensee (License)',
  'JV Partner',
  'Operator (JV)'
];

export function getRoleSuggestions(opts?: { caseType?: string | null; sectorLabel?: string | null; matterType?: string | null }) {
  // Prefer matterType (workflow) -> caseType -> sectorLabel for targeted suggestions
  const caseType = opts?.caseType;
  const sectorLabel = opts?.sectorLabel;
  const matterType = opts?.matterType;
  const lower = String(matterType || caseType || sectorLabel || '').toLowerCase();
  const suggestions = new Set<string>();

  // Always include general/core parties first
  ['Natural Person','Client','Witness','Expert Witness','Representative','Agent','Company','Partnership','Advocate'].forEach((r) => suggestions.add(r));

  if (lower.includes('litigation') || lower.includes('civil') || lower.includes('trial') || lower.includes('claim') || lower.includes('lawsuit')) {
    ['Claimant','Respondent','Appellant','Intervenor','Interested Party','Amicus Curiae','Garnishee','Receiver'].forEach((r) => suggestions.add(r));
  }
  if (lower.includes('criminal') || lower.includes('offence') || lower.includes('prosecution')) {
    ['Prosecution','Accused','Defendant','Co-Accused','Suspect','Complainant','Victim','Surety','Juvenile'].forEach((r) => suggestions.add(r));
  }
  if (lower.includes('family') || lower.includes('divorce') || lower.includes('custody')) {
    ['Husband','Wife','Spouse','Former Spouse','Applicant','Respondent (Family)','Parent','Child','Guardian (Family)'].forEach((r) => suggestions.add(r));
  }
  if (lower.includes('commercial') || lower.includes('corporate') || lower.includes('transaction') || lower.includes('share') || lower.includes('acquir') ) {
    ['Seller','Purchaser','Buyer','Creditor','Debtor','Guarantor','Shareholder','Director','Company'].forEach((r) => suggestions.add(r));
  }
  if (lower.includes('labour') || lower.includes('employment') || lower.includes('work')) {
    ['Employer','Employee','Trade Union','Arbitrator'].forEach((r) => suggestions.add(r));
  }

  // If no specific suggestions found, return the full list
  if (suggestions.size <= 8) return FULL_PARTY_ROLES;

  return Array.from(suggestions);
}
