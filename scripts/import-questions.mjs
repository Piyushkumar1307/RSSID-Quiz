import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const source = process.argv[2];
if (!source) throw new Error('Usage: npm run import:questions -- /absolute/path/to/questions.docx');

const text = execFileSync('textutil', ['-convert', 'txt', '-stdout', source], { encoding: 'utf8' });
const answerStart = text.search(/Answer\s*Key/i);
const questionText = answerStart >= 0 ? text.slice(0, answerStart) : text;
const answerText = answerStart >= 0 ? text.slice(answerStart) : text;
const answers = Object.fromEntries([...answerText.matchAll(/(?:Q?)(\d{1,3})\.\s*([A-D])\b/g)].map(([, id, answer]) => [Number(id), answer]));
const blocks = questionText.split(/(?=Q\d+\.\s)/).filter((part) => /^Q\d+\.\s/.test(part));
const questions = blocks.map((block) => {
  const [, id, prompt, a, b, c, d] = block.match(/^Q(\d+)\.\s*([\s\S]*?)\nA\.\s*([^\n]+)\nB\.\s*([^\n]+)\nC\.\s*([^\n]+)\nD\.\s*([^\n]+)/) || [];
  if (!id || !answers[Number(id)]) throw new Error(`Could not parse question block: ${block.slice(0, 80)}`);
  return { id: Number(id), question: prompt.trim(), options: { A: a.trim(), B: b.trim(), C: c.trim(), D: d.trim() }, answer: answers[Number(id)] };
});
if (questions.length !== 100) throw new Error(`Expected 100 questions but found ${questions.length}`);
mkdirSync('server', { recursive: true });
writeFileSync('server/questions.js', `// Generated from the supplied RSSDI document. Keep answers server-only.\nexport const questions = ${JSON.stringify(questions, null, 2)};\n`);
console.log(`Imported ${questions.length} questions into server/questions.js`);
