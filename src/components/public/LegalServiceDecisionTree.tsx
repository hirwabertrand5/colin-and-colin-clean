import { LEGAL_SERVICES_TREE, type ServiceNode } from '../../constants/legalServicesTree';

type Props = { value: string; onChange: (id: string) => void; prefix: string; required?: boolean; fixedId?: string; disabled?: boolean };
const findPath = (nodes: ServiceNode[], id: string, path: ServiceNode[] = []): ServiceNode[] => {
  for (const node of nodes) {
    if (node.id === id) return [...path, node];
    const found = findPath(node.children || [], id, [...path, node]);
    if (found.length) return found;
  }
  return [];
};

export default function LegalServiceDecisionTree({ value, onChange, prefix, required, fixedId, disabled }: Props) {
  const selected = findPath(LEGAL_SERVICES_TREE, value);
  const fixed = fixedId ? findPath(LEGAL_SERVICES_TREE, fixedId) : [];
  const levels: Array<{ options: ServiceNode[]; selected?: ServiceNode }> = [];
  let options = LEGAL_SERVICES_TREE;
  for (let i = 0; options.length; i++) {
    const node = options.find(option => option.id === selected[i]?.id);
    levels.push({ options, selected: node });
    options = node?.children || [];
  }
  return <div className="intake-service-tree intake-grid" aria-label="Legal service decision tree">
    {levels.map((level, index) => <div className="intake-field" key={index}>
      <label htmlFor={`${prefix}-service-${index}`}>{['Department', 'Service category', 'Legal service'][Math.min(index, 2)]}{index > 2 ? ` · level ${index + 1}` : ''}{required ? ' *' : ''}</label>
      <select className="intake-input" id={`${prefix}-service-${index}`} value={level.selected?.id || ''} required={required} disabled={disabled || index < fixed.length}
        onChange={event => onChange(event.target.value || selected[index - 1]?.id || '')}>
        <option value="">{index === 0 ? 'Choose a department' : 'Choose a category or service'}</option>
        {level.options.map(node => <option value={node.id} key={node.id}>{node.label}</option>)}
      </select>
    </div>)}
  </div>;
}
