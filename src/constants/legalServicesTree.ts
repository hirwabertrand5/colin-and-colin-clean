import { CaseType } from '../services/caseService';

export type ServiceNode = {
  id: string;
  label: string;
  caseType?: CaseType;
  suggestedMatterTypes?: string[];
  children?: ServiceNode[];
};

export const LEGAL_SERVICES_TREE: ServiceNode[] = [
  {
    id: 'dispute_resolution',
    label: 'A. Dispute Resolution',
    caseType: 'Litigation Cases',
    children: [
      {
        id: 'litigation',
        label: 'Litigation',
        caseType: 'Litigation Cases',
        children: [
          {
            id: 'commercial_litigation',
            label: 'Commercial Litigation',
            caseType: 'Litigation Cases',
            suggestedMatterTypes: ['Commercial Litigation'],
            children: [
              { id: 'contractual_disputes', label: 'Contractual Disputes', caseType: 'Litigation Cases' },
              { id: 'shareholder_corporate_disputes', label: 'Shareholder & Corporate Disputes', caseType: 'Litigation Cases' },
              { id: 'banking_financial_disputes', label: 'Banking & Financial Disputes', caseType: 'Litigation Cases' },
              { id: 'tax_litigation', label: 'Tax Litigation', caseType: 'Litigation Cases' },
              {
                id: 'competition_antitrust_litigation',
                label: 'Competition / Antitrust Litigation',
                caseType: 'Litigation Cases',
                children: [
                  { id: 'merger_related_disputes', label: 'Merger-related disputes', caseType: 'Litigation Cases' },
                  { id: 'cartel_investigations', label: 'Cartel investigations', caseType: 'Litigation Cases' },
                  { id: 'abuse_of_dominance_claims', label: 'Abuse of dominance claims', caseType: 'Litigation Cases' },
                  {
                    id: 'competition_regulatory_challenges',
                    label: 'Competition regulatory challenges',
                    caseType: 'Litigation Cases',
                  },
                ],
              },
              {
                id: 'intellectual_property_litigation',
                label: 'Intellectual Property Litigation',
                caseType: 'Litigation Cases',
                children: [
                  { id: 'trademark_disputes', label: 'Trademark disputes', caseType: 'Litigation Cases' },
                  { id: 'copyright_disputes', label: 'Copyright disputes', caseType: 'Litigation Cases' },
                  { id: 'ip_enforcement_infringement', label: 'IP enforcement & infringement', caseType: 'Litigation Cases' },
                ],
              },
            ],
          },
          {
            id: 'civil_litigation',
            label: 'Civil Litigation',
            caseType: 'Litigation Cases',
            suggestedMatterTypes: ['Civil Litigation'],
            children: [
              {
                id: 'contractual_disputes_private',
                label: 'Contractual disputes (non-commercial/private disputes)',
                caseType: 'Litigation Cases',
              },
              { id: 'property_disputes', label: 'Property disputes', caseType: 'Litigation Cases' },
              { id: 'tort_liability_claims', label: 'Tort/liability claims', caseType: 'Litigation Cases' },
              { id: 'debt_recovery_enforcement', label: 'Debt recovery & enforcement', caseType: 'Litigation Cases' },
              { id: 'succession_estate_disputes', label: 'Succession & estate disputes', caseType: 'Litigation Cases' },
              { id: 'divorce', label: 'Divorce', caseType: 'Litigation Cases' },
            ],
          },
          {
            id: 'criminal_litigation',
            label: 'Criminal Litigation',
            caseType: 'Litigation Cases',
            suggestedMatterTypes: ['Criminal Procedure'],
            children: [
              { id: 'general_criminal_defence', label: 'General Criminal Defence', caseType: 'Litigation Cases' },
            ],
          },
          {
            id: 'labour_employment_litigation',
            label: 'Labour & Employment Litigation',
            caseType: 'Labor Cases',
            suggestedMatterTypes: ['Labor Case Handling'],
          },
          {
            id: 'administrative_litigation',
            label: 'Administrative Litigation',
            caseType: 'Litigation Cases',
            children: [
              {
                id: 'judicial_review_government_decisions',
                label: 'Judicial review of government decisions',
                caseType: 'Litigation Cases',
              },
              {
                id: 'licensing_regulatory_disputes',
                label: 'Licensing and regulatory disputes',
                caseType: 'Litigation Cases',
              },
              { id: 'public_procurement_disputes', label: 'Public procurement disputes', caseType: 'Litigation Cases' },
              {
                id: 'administrative_penalties_challenges',
                label: 'Challenges against administrative penalties',
                caseType: 'Litigation Cases',
              },
            ],
          },
          {
            id: 'constitutional_litigation',
            label: 'Constitutional Litigation',
            caseType: 'Litigation Cases',
            children: [
              {
                id: 'constitutional_rights_enforcement',
                label: 'Constitutional rights enforcement',
                caseType: 'Litigation Cases',
              },
              {
                id: 'judicial_review_legislation',
                label: 'Judicial review of legislation',
                caseType: 'Litigation Cases',
              },
              { id: 'public_interest_litigation', label: 'Public interest litigation', caseType: 'Litigation Cases' },
              {
                id: 'constitutional_provisions_interpretation',
                label: 'Interpretation of constitutional provisions',
                caseType: 'Litigation Cases',
              },
            ],
          },
        ],
      },
      {
        id: 'alternative_dispute_resolution',
        label: 'Alternative Dispute Resolution (ADR)',
        caseType: 'Litigation Cases',
        children: [
          { id: 'mediation', label: 'Mediation', caseType: 'Litigation Cases', suggestedMatterTypes: ['Mediation'] },
          {
            id: 'arbitration',
            label: 'Arbitration (Domestic / International)',
            caseType: 'Litigation Cases',
            suggestedMatterTypes: ['Arbitration'],
          },
          {
            id: 'negotiation_settlement_strategy',
            label: 'Negotiation & Settlement Strategy',
            caseType: 'Litigation Cases',
          },
          { id: 'expert_determination', label: 'Expert Determination', caseType: 'Litigation Cases' },
        ],
      },
    ],
  },
  {
    id: 'transactions_advisory',
    label: 'B. Transactions & Advisory',
    caseType: 'Transactional Cases',
    children: [
      {
        id: 'corporate_commercial',
        label: 'Corporate & Commercial',
        caseType: 'Transactional Cases',
        children: [
          { id: 'mergers_acquisitions', label: 'Mergers & Acquisitions (M&A)', caseType: 'Transactional Cases' },
          {
            id: 'corporate_structuring_governance',
            label: 'Corporate Structuring & Governance',
            caseType: 'Transactional Cases',
            suggestedMatterTypes: ['Business Registration'],
          },
          { id: 'shareholder_agreements', label: 'Shareholder Agreements', caseType: 'Transactional Cases' },
          { id: 'joint_ventures', label: 'Joint Ventures', caseType: 'Transactional Cases' },
          {
            id: 'contract_drafting_negotiation',
            label: 'Contract Drafting & Negotiation',
            caseType: 'Transactional Cases',
          },
        ],
      },
      {
        id: 'banking_finance',
        label: 'Banking & Finance',
        caseType: 'Transactional Cases',
        children: [
          {
            id: 'project_finance',
            label: 'Project Finance',
            caseType: 'Transactional Cases',
            children: [
              {
                id: 'large_scale_infrastructure_energy_structuring',
                label: 'Structuring of large-scale infrastructure or energy projects',
                caseType: 'Transactional Cases',
              },
              {
                id: 'financing_agreements_drafting',
                label: 'Drafting and negotiation of financing agreements',
                caseType: 'Transactional Cases',
              },
              { id: 'lender_borrower_representation', label: 'Lender and borrower representation', caseType: 'Transactional Cases' },
              {
                id: 'risk_allocation_project_finance',
                label: 'Risk allocation (EPC contracts, concession agreements)',
                caseType: 'Transactional Cases',
              },
              {
                id: 'due_diligence_bankability',
                label: 'Due diligence and bankability assessments',
                caseType: 'Transactional Cases',
              },
            ],
          },
          {
            id: 'corporate_finance',
            label: 'Corporate Finance',
            caseType: 'Transactional Cases',
            children: [
              { id: 'capital_raising', label: 'Capital raising (debt and equity)', caseType: 'Transactional Cases' },
              { id: 'investment_structuring', label: 'Investment structuring', caseType: 'Transactional Cases' },
              { id: 'private_placements', label: 'Private placements', caseType: 'Transactional Cases' },
              {
                id: 'financial_documentation_drafting',
                label: 'Financial documentation drafting',
                caseType: 'Transactional Cases',
              },
              { id: 'corporate_funding_strategy', label: 'Corporate funding strategy', caseType: 'Transactional Cases' },
            ],
          },
          {
            id: 'debt_structuring',
            label: 'Debt Structuring',
            caseType: 'Transactional Cases',
            children: [
              { id: 'loan_restructuring_refinancing', label: 'Loan restructuring and refinancing', caseType: 'Transactional Cases' },
              { id: 'debt_rescheduling_negotiations', label: 'Debt rescheduling negotiations', caseType: 'Transactional Cases' },
              { id: 'insolvency_adjacent_advisory', label: 'Insolvency-adjacent advisory', caseType: 'Transactional Cases' },
              { id: 'inter_creditor_arrangements', label: 'Inter-creditor arrangements', caseType: 'Transactional Cases' },
            ],
          },
          {
            id: 'security_collateral_arrangements',
            label: 'Security & Collateral Arrangements',
            caseType: 'Transactional Cases',
            children: [
              {
                id: 'security_agreements_drafting',
                label: 'Drafting security agreements (mortgages, charges, pledges)',
                caseType: 'Transactional Cases',
              },
              {
                id: 'perfection_registration_security_interests',
                label: 'Perfection and registration of security interests',
                caseType: 'Transactional Cases',
              },
              { id: 'enforcement_strategy', label: 'Enforcement strategy', caseType: 'Transactional Cases' },
              { id: 'collateral_risk_assessment', label: 'Collateral risk assessment', caseType: 'Transactional Cases' },
            ],
          },
          {
            id: 'financial_regulatory_advisory',
            label: 'Financial Regulatory Advisory',
            caseType: 'Transactional Cases',
            children: [
              { id: 'licensing_financial_institutions', label: 'Licensing of financial institutions', caseType: 'Transactional Cases' },
              {
                id: 'central_bank_regulations_compliance',
                label: 'Compliance with central bank regulations',
                caseType: 'Transactional Cases',
              },
              { id: 'aml_compliance', label: 'Anti-money laundering (AML) compliance', caseType: 'Transactional Cases' },
              {
                id: 'capital_adequacy_prudential_requirements',
                label: 'Capital adequacy and prudential requirements',
                caseType: 'Transactional Cases',
              },
              { id: 'regulatory_engagement_approvals', label: 'Regulatory engagement and approvals', caseType: 'Transactional Cases' },
            ],
          },
        ],
      },
      {
        id: 'employment_labour_advisory',
        label: 'Employment & Labour Advisory',
        caseType: 'Labor Cases',
        children: [
          { id: 'employment_contracts', label: 'Employment Contracts', caseType: 'Labor Cases' },
          { id: 'workplace_policies', label: 'Workplace Policies', caseType: 'Labor Cases' },
          { id: 'disciplinary_termination_processes', label: 'Disciplinary & Termination Processes', caseType: 'Labor Cases' },
          { id: 'retrenchments_restructuring', label: 'Retrenchments & Restructuring', caseType: 'Labor Cases' },
          { id: 'executive_compensation', label: 'Executive Compensation', caseType: 'Labor Cases' },
        ],
      },
      {
        id: 'regulatory_compliance',
        label: 'Regulatory, Compliance & Governance',
        caseType: 'Transactional Cases',
        children: [
          {
            id: 'entity_formation_regulatory_registration',
            label: 'Entity Formation & Regulatory Registration',
            caseType: 'Transactional Cases',
            children: [
              {
                id: 'company_incorporation',
                label: 'Company Incorporation',
                caseType: 'Transactional Cases',
                suggestedMatterTypes: ['Business Registration'],
              },
              {
                id: 'ngo_registration',
                label: 'NGO Registration',
                caseType: 'Transactional Cases',
                suggestedMatterTypes: ['NGO Registration'],
              },
              {
                id: 'foundation_non_profit_incorporation',
                label: 'Foundation / Non-Profit Incorporation',
                caseType: 'Transactional Cases',
                suggestedMatterTypes: ['Business Registration'],
              },
              {
                id: 'cooperative_registration',
                label: 'Cooperative Registration',
                caseType: 'Transactional Cases',
                suggestedMatterTypes: ['Business Registration'],
              },
              {
                id: 'associations',
                label: 'Associations',
                caseType: 'Transactional Cases',
                suggestedMatterTypes: ['Business Registration'],
              },
              {
                id: 'tontines',
                label: 'Tontines',
                caseType: 'Transactional Cases',
                suggestedMatterTypes: ['Tontine Registration'],
              },
            ],
          },
          {
            id: 'corporate_compliance_programs',
            label: 'Corporate Compliance Programs',
            caseType: 'Transactional Cases',
          },
          { id: 'risk_management_frameworks', label: 'Risk Management Frameworks', caseType: 'Transactional Cases' },
          { id: 'licensing_approvals', label: 'Licensing & Approvals', caseType: 'Transactional Cases' },
          { id: 'esg_sustainability_compliance', label: 'ESG & Sustainability Compliance', caseType: 'Transactional Cases' },
        ],
      },
      {
        id: 'real_estate_projects',
        label: 'Real Estate & Projects',
        caseType: 'Transactional Cases',
        children: [
          {
            id: 'property_transactions',
            label: 'Property Transactions',
            caseType: 'Transactional Cases',
            children: [
              { id: 'sale_purchase_agreements', label: 'Sale and purchase agreements', caseType: 'Transactional Cases' },
              { id: 'title_due_diligence', label: 'Title due diligence', caseType: 'Transactional Cases', suggestedMatterTypes: ['Due Diligence (Land)'] },
              { id: 'transfer_registration', label: 'Transfer and registration', caseType: 'Transactional Cases' },
              { id: 'escrow_structuring', label: 'Escrow structuring', caseType: 'Transactional Cases' },
            ],
          },
          {
            id: 'land_use_development',
            label: 'Land Use & Development',
            caseType: 'Transactional Cases',
            children: [
              { id: 'zoning_land_use_approvals', label: 'Zoning and land use approvals', caseType: 'Transactional Cases' },
              { id: 'development_structuring', label: 'Development structuring', caseType: 'Transactional Cases' },
              { id: 'land_regulatory_compliance', label: 'Regulatory compliance', caseType: 'Transactional Cases' },
              { id: 'government_engagement_land', label: 'Government engagement', caseType: 'Transactional Cases' },
            ],
          },
          {
            id: 'infrastructure_projects',
            label: 'Infrastructure Projects',
            caseType: 'Transactional Cases',
            children: [
              { id: 'ppp_structuring', label: 'PPP structuring', caseType: 'Transactional Cases' },
              { id: 'concession_agreements', label: 'Concession agreements', caseType: 'Transactional Cases' },
              { id: 'project_risk_allocation', label: 'Project risk allocation', caseType: 'Transactional Cases' },
              { id: 'government_investor_advisory', label: 'Government and investor advisory', caseType: 'Transactional Cases' },
            ],
          },
          {
            id: 'construction_law',
            label: 'Construction Law',
            caseType: 'Transactional Cases',
            children: [
              { id: 'epc_construction_contracts', label: 'EPC and construction contracts', caseType: 'Transactional Cases' },
              { id: 'contractor_disputes', label: 'Contractor disputes', caseType: 'Transactional Cases' },
              { id: 'project_execution_advisory', label: 'Project execution advisory', caseType: 'Transactional Cases' },
              { id: 'claims_variation_management', label: 'Claims and variation management', caseType: 'Transactional Cases' },
            ],
          },
        ],
      },
      {
        id: 'tax_advisory',
        label: 'Tax Advisory',
        caseType: 'Transactional Cases',
        children: [
          { id: 'corporate_tax_structuring', label: 'Corporate Tax Structuring', caseType: 'Transactional Cases' },
          { id: 'international_tax', label: 'International Tax', caseType: 'Transactional Cases' },
          { id: 'tax_risk_management', label: 'Tax Risk Management', caseType: 'Transactional Cases' },
          { id: 'vat_indirect_tax', label: 'VAT & Indirect Tax', caseType: 'Transactional Cases' },
        ],
      },
      {
        id: 'tmt',
        label: 'Technology, Media & Telecommunications (TMT)',
        caseType: 'Transactional Cases',
        children: [
          {
            id: 'data_protection_privacy',
            label: 'Data Protection & Privacy',
            caseType: 'Transactional Cases',
            children: [
              {
                id: 'data_protection_frameworks',
                label: 'Data protection compliance frameworks',
                caseType: 'Transactional Cases',
              },
              { id: 'privacy_policies_audits', label: 'Privacy policies and audits', caseType: 'Transactional Cases' },
              {
                id: 'cross_border_data_transfer_advisory',
                label: 'Cross-border data transfer advisory',
                caseType: 'Transactional Cases',
              },
            ],
          },
          {
            id: 'cybersecurity',
            label: 'Cybersecurity',
            caseType: 'Transactional Cases',
            children: [
              { id: 'incident_response_advisory', label: 'Incident response advisory', caseType: 'Transactional Cases' },
              { id: 'cyber_risk_assessments', label: 'Risk assessments', caseType: 'Transactional Cases' },
              { id: 'cyber_regulatory_compliance', label: 'Regulatory compliance', caseType: 'Transactional Cases' },
            ],
          },
          {
            id: 'it_technology_contracts',
            label: 'IT & Technology Contracts',
            caseType: 'Transactional Cases',
            children: [
              { id: 'saas_agreements', label: 'SaaS agreements', caseType: 'Transactional Cases' },
              { id: 'licensing_agreements', label: 'Licensing agreements', caseType: 'Transactional Cases' },
              { id: 'system_implementation_contracts', label: 'System implementation contracts', caseType: 'Transactional Cases' },
            ],
          },
          {
            id: 'commercial_ip',
            label: 'Intellectual Property (Commercial)',
            caseType: 'Transactional Cases',
            children: [
              { id: 'ip_licensing', label: 'IP licensing', caseType: 'Transactional Cases' },
              { id: 'commercialisation_strategies', label: 'Commercialisation strategies', caseType: 'Transactional Cases' },
              { id: 'technology_transfer_agreements', label: 'Technology transfer agreements', caseType: 'Transactional Cases' },
            ],
          },
          {
            id: 'digital_regulation',
            label: 'Digital Regulation',
            caseType: 'Transactional Cases',
            children: [
              { id: 'platform_regulation', label: 'Platform regulation', caseType: 'Transactional Cases' },
              { id: 'fintech_compliance', label: 'Fintech compliance', caseType: 'Transactional Cases' },
              { id: 'emerging_technology_advisory', label: 'Emerging technology advisory', caseType: 'Transactional Cases' },
            ],
          },
        ],
      },
    ],
  },
];
