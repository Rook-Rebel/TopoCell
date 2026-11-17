// Vitest-ის JSON ანგარიშიდან ინახავს მხოლოდ შეჯამებას (ლოკალური ბილიკების გარეშე) → experiments/audit/tests.json
// გაშვება: npm run test:save
import { readFileSync, writeFileSync, rmSync } from 'node:fs';

const RAW = 'experiments/audit/.tests.raw.json';
const raw = JSON.parse(readFileSync(RAW, 'utf8'));
const tests = (raw.testResults ?? []).flatMap((file) =>
  (file.assertionResults ?? []).map((t) => ({ group: (t.ancestorTitles ?? []).join(' › '), title: t.title, status: t.status })),
);
writeFileSync(
  'experiments/audit/tests.json',
  JSON.stringify(
    {
      generatedBy: 'npm run test:save (vitest → scripts/tests-summary.mjs)',
      success: raw.success,
      numTotalTests: raw.numTotalTests,
      numPassedTests: raw.numPassedTests,
      numFailedTests: raw.numFailedTests,
      tests,
    },
    null,
    2,
  ),
);
rmSync(RAW, { force: true });
console.log(`tests.json: ${raw.numPassedTests}/${raw.numTotalTests} გავიდა`);
