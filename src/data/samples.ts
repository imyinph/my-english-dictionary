import type { ContentSource, DictionaryEntry, EntryLink, Sense } from '../domain/dictionary.ts';

export const sampleSource: ContentSource = {
  id: 'm0-authored-fixtures',
  title: 'M0 人工编排的测试内容（含 AI 辅助）',
  license: '项目测试样例；非第三方授权词典数据',
  attribution: '由本项目为界面与导航测试编写，未经专业词典校验，不用于正式学习。',
  isTestData: true,
};

const link = (entryId: string, label = entryId, note?: string): EntryLink => ({ entryId, label, note });
const family = [link('create', 'create', 'verb'), link('creation', 'creation', 'noun'), link('creator', 'creator', 'noun'), link('creative', 'creative', 'adjective'), link('creatively', 'creatively', 'adverb'), link('creativity', 'creativity', 'noun')];

function sense(
  id: string, partOfSpeech: string, definition: string, explanation: string, translation: string,
  examples: [string, string, string[]][], synonyms: EntryLink[] = [], antonyms: EntryLink[] = [],
): Sense {
  return {
    id, partOfSpeech, definition, explanation, translation, synonyms, antonyms, source: sampleSource,
    examples: examples.map(([text, translated, highlights], i) => ({
      id: `${id}:example:${i + 1}`, text, translation: translated, highlights, source: sampleSource,
    })),
  };
}

function entry(id: string, senses: Sense[], extra: Partial<DictionaryEntry> = {}): DictionaryEntry {
  return { id, headword: id, kind: 'word', senses, wordFamily: family.filter(x => x.entryId !== id && family.some(f => f.entryId === id)), wordForms: [], phrases: [], keywords: [], source: sampleSource, ...extra };
}

export const sampleEntries: DictionaryEntry[] = [
  entry('create', [
    sense('create:bring-into-existence', 'verb', 'To make something new.', 'When you create something, you bring an idea or an object into existence.', '创造；创作出新的事物。', [
      ['We create games.', '我们创作游戏。', ['create']],
      ['A creative team can create a story from a simple idea.', '富有创意的团队可以从一个简单的想法创作出故事。', ['create']],
    ], [link('make', 'make', 'A broader word for producing something; only this sense is related here.')], [link('destroy', 'destroy', 'The opposite action: ruining something that already exists.')]),
    sense('create:cause', 'verb', 'To cause a situation to happen.', 'Something can create a problem or an opportunity by making it happen.', '造成；引起某种状况。', [
      ['Noise can create problems.', '噪声可能造成问题。', ['create']],
      ['The new park could create opportunities for local artists.', '新公园可能为当地艺术家创造机会。', ['create']],
    ]),
  ], { wordForms: [
    { ...link('create', 'creates'), grammaticalForm: 'third-person singular' },
    { ...link('create', 'created'), grammaticalForm: 'past / past participle' },
    { ...link('create', 'creating'), grammaticalForm: 'present participle' },
  ] }),
  entry('creative', [sense('creative:ideas', 'adjective', 'Good at thinking of new ideas.', 'A creative person uses imagination to find new ways of making or doing things.', '有创造力的；善于提出新想法的。', [
    ['She is creative.', '她很有创造力。', ['creative']],
    ['The creator found a creative way to tell the story.', '这位创作者找到了一种富有创意的讲述方式。', ['creative']],
  ])], { wordForms: [
    { ...link('creative', 'more creative'), grammaticalForm: 'comparative' },
    { ...link('creative', 'most creative'), grammaticalForm: 'superlative' },
  ] }),
  entry('creation', [sense('creation:process', 'noun', 'The act of making something new.', 'Creation is the process in which an idea becomes something that exists.', '创造；创作的过程。', [
    ['Creation takes time.', '创作需要时间。', ['Creation']],
    ['The creation of the garden brought the neighbours together.', '花园的建造让邻居们聚到了一起。', ['creation']],
  ])]),
  entry('creator', [sense('creator:person', 'noun', 'A person who makes something new.', 'The creator of a work is the person who brings it into existence.', '创造者；创作者。', [
    ['Meet the creator.', '见见这位创作者。', ['creator']],
    ['The creator of the game shared her first drawings.', '这款游戏的创作者分享了她最初的草图。', ['creator']],
  ])], { wordForms: [{ ...link('creator', 'creators'), grammaticalForm: 'plural' }] }),
  entry('creatively', [sense('creatively:manner', 'adverb', 'In a way that uses new ideas.', 'If you work creatively, you use imagination while doing your work.', '创造性地；有创意地。', [
    ['Think creatively.', '创造性地思考。', ['creatively']],
    ['We used the small space creatively to make a quiet reading area.', '我们创造性地利用这块小空间，打造了一个安静的阅读区。', ['creatively']],
  ])]),
  entry('creativity', [sense('creativity:ability', 'noun', 'The ability to think of new ideas.', 'Creativity helps you imagine and make things in your own way.', '创造力；想出新点子的能力。', [
    ['Play encourages creativity.', '玩耍有助于培养创造力。', ['creativity']],
    ['The project gave every creator room to show their creativity.', '这个项目让每位创作者都有空间展示创造力。', ['creativity']],
  ])]),
  entry('make', [sense('make:produce', 'verb', 'To produce or build something.', 'When you make something, you put materials or ideas together to produce it.', '制作；做出。', [
    ['We make bread.', '我们做面包。', ['make']],
    ['You can make a small box from a sheet of paper.', '你可以用一张纸做一个小盒子。', ['make']],
  ], [link('create')])], { wordForms: [
    { ...link('make', 'made'), grammaticalForm: 'past / past participle' },
    { ...link('make', 'making'), grammaticalForm: 'present participle' },
    { ...link('make', 'makes'), grammaticalForm: 'third-person singular' },
  ], phrases: [link('make-sense', 'make sense')] }),
  entry('destroy', [sense('destroy:damage', 'verb', 'To damage something so badly that it cannot be used.', 'If you destroy something, you ruin it or cause it to stop existing.', '摧毁；使事物无法继续使用或存在。', [
    ['Fire can destroy a home.', '火灾可能摧毁一个家。', ['destroy']],
    ['The storm could destroy the bridge that links the two villages.', '暴风雨可能摧毁连接两个村庄的桥梁。', ['destroy']],
  ], [], [link('create')])], { wordForms: [{ ...link('destroy', 'destroyed'), grammaticalForm: 'past / past participle' }] }),
  entry('make-sense', [sense('make-sense:understandable', 'phrase', 'To be clear and easy to understand.', 'If something makes sense, you can understand it or see a reason for it.', '有道理；意思清楚，能够理解。', [
    ['Your ideas make sense.', '你的想法有道理。', ['make sense']],
    ['The instructions make sense when you look at the picture.', '看着图时，这些说明就容易理解了。', ['make sense']],
  ])], { kind: 'phrase', headword: 'make sense', keywords: [link('make'), link('sense')] }),
  entry('sense', [sense('sense:meaning', 'noun', 'A meaning of a word or expression.', 'A word can have more than one sense when people use it in different ways.', '词或表达的意思；义项。', [
    ['Which sense do you mean?', '你指的是哪个意思？', ['sense']],
    ['The example helps us understand this sense of the word.', '这个例句有助于我们理解该词的这个义项。', ['sense']],
  ])], { wordForms: [{ ...link('sense', 'senses'), grammaticalForm: 'plural' }], phrases: [link('make-sense', 'make sense')] }),
];
