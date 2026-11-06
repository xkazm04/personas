// A figure: digits joined by : . , or - between digit groups, with an optional trailing percent.
const FIGURE = /(\d+(?:[:.,-]\d+)*%?)/;

export interface FigsProps {
  text: string;
}

/**
 * Figs: prose whose figures set in the mono face (tabular, slashed zero), the words left as they are.
 * @catalog Figs - a sentence with every figure (counts, times, percents) wrapped in the .num mono utility.
 */
export function Figs({ text }: FigsProps) {
  return (
    <>
      {text.split(FIGURE).map((part, i) => (i % 2 === 1 ? <span key={i} className="num">{part}</span> : part))}
    </>
  );
}
