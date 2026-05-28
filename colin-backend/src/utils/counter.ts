import Counter from '../models/counterModel';

export const getNextCounterValue = async (key: string): Promise<number> => {
  const counter = await Counter.findOneAndUpdate(
    { key },
    { $inc: { seq: 1 }, $setOnInsert: { key } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  return counter.seq;
};

export const buildYearlySequence = async (keyPrefix: string, prefix: string): Promise<string> => {
  const year = new Date().getFullYear();
  const seq = await getNextCounterValue(`${keyPrefix}:${year}`);
  return `${prefix}-${year}-${String(seq).padStart(5, '0')}`;
};
