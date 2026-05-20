/**
 * Shape CRM fields QuestRock AI may populate from call transcripts.
 * Keys must match Shape API field names exactly.
 */
export const SHAPE_FIELD_CATALOG = [
  { key: 'firstname', label: 'First Name', hint: 'Borrower first name.' },
  { key: 'lastname', label: 'Last Name', hint: 'Borrower last name.' },
  { key: 'phone', label: 'Mobile Phone', hint: 'US phone → +1XXXXXXXXXX when 10 digits known.' },
  { key: 'email', label: 'Email', hint: 'Borrower email if stated on call.' },
  { key: 'boraddress', label: 'Present Address', hint: 'Borrower current street address.' },
  { key: 'borcity', label: 'Present City', hint: 'Borrower current city.' },
  { key: 'borstate', label: 'Present State', hint: '2-letter USPS state abbreviation.' },
  { key: 'borzip', label: 'Present Zip', hint: '5-digit ZIP when possible.' },
  { key: 'prStreetAddress', label: 'Subject Property Address', hint: 'Property being financed.' },
  { key: 'prAddressLine2', label: 'Subject Unit/Apt', hint: 'Unit or apartment number.' },
  { key: 'prCity', label: 'Subject City', hint: '' },
  { key: 'prState', label: 'Subject State', hint: '2-letter USPS abbreviation.' },
  { key: 'prZip', label: 'Subject Zip', hint: '' },
  { key: 'prCounty', label: 'Subject County', hint: '' },
  { key: 'prCountry', label: 'Subject Country', hint: 'Use "United States" when US property.' },
  { key: 'qkapppropertyType', label: 'Property Type', hint: 'e.g. Single Family, Condo, Multi-Family, Investment.' },
  { key: 'qkappnumberOfunits', label: 'Number of Units', hint: 'Plain integer as string.' },
  { key: 'qkappestAppraisalVal', label: 'Estimated Value', hint: 'Digits only, no $ or commas.' },
  { key: 'propropertyUse', label: 'Occupancy / Use', hint: 'Primary, Second Home, Investment, etc.' },
  { key: 'qkapppurpose', label: 'Loan Purpose', hint: 'Purchase, Refinance, Cash-Out, DSCR investment, etc.' },
  { key: 'LoanAmount', label: 'Loan Amount', hint: 'Digits only, no $ or commas.' },
  { key: 'borcreditscore', label: 'Credit Score', hint: 'Stated FICO or range; digits only.' },
  { key: 'notes_sidebar', label: 'Goals & Objectives', hint: 'Brief borrower goals/objectives from call — not full transcript.' },
  { key: 'boryearsAtpresent', label: 'Years at Present Address', hint: '' },
  { key: 'bormonthsAtCurrent', label: 'Months at Present Address', hint: '' },
  { key: 'bormaritalstatusdetails', label: 'Marital Status', hint: '' },
  { key: 'borcitizenship', label: 'Citizenship', hint: '' },
  { key: 'leadveteran', label: 'Military Service', hint: 'Yes/No if discussed.' },
  { key: 'bornumOfdepend', label: 'Number of Dependents', hint: '' },
  { key: 'borageOfdepend', label: 'Age of Dependents', hint: '' },
  { key: 'borempinfoEmpPosition', label: 'Job Title', hint: '' },
  { key: 'borempinfoEmpType', label: 'Employment Type', hint: 'W-2, 1099, self-employed, business owner, etc.' },
  { key: 'boremployer', label: 'Employer Name', hint: '' },
  { key: 'boryearsonjob', label: 'Years on Job', hint: '' },
  { key: 'borempaddress', label: 'Employer Address', hint: '' },
  { key: 'borempPhone', label: 'Employer Phone', hint: '+1XXXXXXXXXX when possible.' },
  { key: 'altpayFrequency', label: 'Pay Frequency', hint: '' },
  { key: 'boryearsInwork', label: 'Years in Line of Work', hint: '' },
  { key: 'altemploymentHistory', label: 'Employment History Notes', hint: 'If < 2 years or gaps explained.' },
];

export const EXTRACTABLE_FIELDS = SHAPE_FIELD_CATALOG.map((row) => row.key);

export function buildFieldPromptSection() {
  return SHAPE_FIELD_CATALOG.map(
    (row) => `- ${row.key} (${row.label})${row.hint ? `: ${row.hint}` : ''}`,
  ).join('\n');
}
