import { redactTranscriptPii } from '../lib/transcript-redact.js';

const samples = [
  {
    name: 'formatted SSN',
    input: 'Customer: My social security number is 123-45-6789.',
    mustInclude: ['[SSN REDACTED]'],
    mustNotInclude: ['123-45-6789'],
  },
  {
    name: 'unformatted SSN after social',
    input: 'Caller: my social is 123456789',
    mustInclude: ['[SSN REDACTED]'],
    mustNotInclude: ['123456789'],
  },
  {
    name: 'last four of social',
    input: 'The last four of my social is 6789',
    mustInclude: ['[SSN REDACTED]'],
  },
  {
    name: 'DOB after keyword',
    input: 'Customer: Date of birth is 03/15/1982',
    mustInclude: ['[DOB REDACTED]'],
    mustNotInclude: ['03/15/1982'],
  },
  {
    name: 'speaker line DOB answer',
    input: 'Customer: March 15, 1982',
    mustInclude: ['[DOB REDACTED]'],
    mustNotInclude: ['1982'],
  },
  {
    name: 'keeps recent closing date',
    input: 'We are targeting a closing date of 07/22/2026',
    mustInclude: ['07/22/2026'],
    mustNotInclude: ['[DOB REDACTED]'],
  },
  {
    name: 'social cue only with digits',
    input: 'Agent: What is your social?\nCustomer: 123456789',
    mustInclude: ['[SSN REDACTED]'],
    mustNotInclude: ['123456789'],
  },
  {
    name: 'security number cue',
    input: 'Customer: My security number is 987-65-4321',
    mustInclude: ['[SSN REDACTED]'],
    mustNotInclude: ['987-65-4321'],
  },
];

let failed = 0;

for (const sample of samples) {
  const output = redactTranscriptPii(sample.input);
  const missing = (sample.mustInclude ?? []).filter((token) => !output.includes(token));
  const leaked = (sample.mustNotInclude ?? []).filter((token) => output.includes(token));

  if (missing.length || leaked.length) {
    failed += 1;
    console.error(`FAIL ${sample.name}`);
    console.error('  input:', sample.input);
    console.error('  output:', output);
    if (missing.length) console.error('  missing:', missing);
    if (leaked.length) console.error('  leaked:', leaked);
  } else {
    console.log(`ok ${sample.name}`);
  }
}

if (failed) {
  process.exit(1);
}

console.log('All transcript redaction checks passed.');
