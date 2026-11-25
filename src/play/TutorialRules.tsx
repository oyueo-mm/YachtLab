import { helpEntries } from "../CategoryHelp";
import { comboDiceIds } from "../combo";
import { DieIcon } from "../Dice";
import { bonus, categories, score, upper, type Card, type Category } from "../engine";

const upperCategories = categories.slice(0, 6);
const bonusCard: Card = Object.fromEntries(upperCategories.map((category, index) => {
  const face = index + 1;
  return [category, score([face, face, face, face % 6 + 1, face % 6 + 1], category)];
}));

function Example({ category }: { category: Category }) {
  const { title, text, example } = helpEntries[category];
  const dice = example!.map((value, id) => ({ value, id }));
  const selected = comboDiceIds(dice, category);
  return <li>
    <div><strong>{title}</strong><p>{text}</p></div>
    <span className="tutorial-example-dice" aria-label={`예시 눈 ${example!.join(", ")}`}>
      {dice.map(({ value, id }) => <DieIcon key={id} value={value} className={selected.includes(id) ? "matched" : ""} aria-hidden="true" />)}
    </span>
    <strong className="tutorial-example-score">{score(example!, category)}점</strong>
  </li>;
}

export function TutorialRules() {
  return <section className="tutorial-rules" aria-labelledby="tutorial-rules-title">
    <h2 id="tutorial-rules-title">족보와 점수</h2>
    <details>
      <summary>상단 6칸 · 63점 보너스</summary>
      <ul>{upperCategories.map((category) => <Example key={category} category={category} />)}</ul>
      <p>{helpEntries.bonus.text}</p>
      <div className="tutorial-bonus-example" aria-label="상단 보너스 예시">
        {upperCategories.map((category) => <span key={category}>{helpEntries[category].title} <b>{bonusCard[category]}</b></span>)}
        <strong>{upper(bonusCard)}점 · 보너스 +{bonus(bonusCard)}점</strong>
      </div>
    </details>
    <details>
      <summary>하단 6칸 · 초이스부터 요트까지</summary>
      <ul>{categories.slice(6).map((category) => <Example key={category} category={category} />)}</ul>
    </details>
  </section>;
}
