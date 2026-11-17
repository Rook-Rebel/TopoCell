// მომზადებული ექსპერიმენტები. თითო აღწერს კონფიგურაციის ცვლილებას, კითხვას და იმას, თუ რას უნდა დააკვირდეთ.
import { LabConfig, defaultConfig } from './lab';
import { ScanSpec } from './scan';

export interface Preset {
  id: string;
  title: string;
  question: string;
  watch: string;
  config: LabConfig;
  scan?: ScanSpec;
}

export function presets(): Preset[] {
  const p1 = defaultConfig();
  p1.electrical.mode = 'I';
  p1.electrical.I = 5;
  p1.fairness.constraint = 'none';
  p1.active = 'mobius';

  const p2 = defaultConfig();
  p2.electrical.mode = 'P';
  p2.electrical.P = 12;
  p2.fairness.constraint = 'area';
  p2.active = 'mobius';

  const p3 = defaultConfig();
  p3.electrical.mode = 'I';
  p3.electrical.I = 5;
  p3.fairness.constraint = 'volume';
  p3.active = 'mobius';

  return [
    {
      id: 'exp1',
      title: '1 · ერთნაირი დენი, განსხვავებული ფართობი',
      question: 'ზრდის თუ არა მეტი ფართობი წყალბადის რაოდენობას, როცა დენი ფიქსირებულია?',
      watch:
        'H₂-ის მოლური ნაკადი ყველა გეომეტრიაში ზუსტად ერთნაირი უნდა იყოს (ფარადეის კანონი). განსხვავდება მხოლოდ ძაბვა და, შესაბამისად, kWh/kg.',
      config: p1,
    },
    {
      id: 'exp2',
      title: '2 · ერთნაირი სიმძლავრე, განსხვავებული გეომეტრია',
      question: 'რომელი ფორმა იძლევა მეტ H₂-ს ერთსა და იმავე სიმძლავრეზე, თუ დასველებული ფართობი გათანაბრებულია?',
      watch:
        'შეადარეთ H₂-ის ნაკადი და უჯრედის მუდმივა K. სხვაობა მოდის ომური წინაღობიდან (განლაგება, დაშორება), არა ტოპოლოგიიდან.',
      config: p2,
    },
    {
      id: 'exp3',
      title: '3 · თანაბარი მასალა, ცვალებადი განლაგება და θ-ის მგრძნობელობა',
      question: 'ერთი და იმავე მასალის ხარჯით რომელი განლაგება სჯობს და რამდენად ცვლის დასკვნას ბუშტუკებით დაფარვა?',
      watch:
        'სკანირება: მიობიუსის ოთხი განლაგება × θ. თუ განლაგებებს შორის სხვაობა θ-ის გავლენაზე ნაკლებია, დასკვნა ბუშტუკების დაშვებაზეა დამოკიდებული.',
      config: p3,
      scan: {
        kind: 'mobius',
        axes: [
          { param: 'arrangement', min: 0, max: 3, steps: 4 },
          { param: 'theta', min: 0, max: 0.45, steps: 4 },
        ],
        objective: 'kwhPerKg',
        maxVolume: null,
        maxEnvelope: null,
        resolution: 40,
        refineTop: 3,
        refineResolution: 60,
      },
    },
  ];
}
