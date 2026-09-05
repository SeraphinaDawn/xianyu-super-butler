import { SlidersHorizontal } from 'lucide-react';
import { DEFAULT_QUOTE_SETTINGS, type QuoteSettings } from '../../services/quoteSettings';
import { buildSampleValues } from '../../utils/quoteTemplate';
import { SectionHeader } from '../ui';
import QuoteTemplateEditor from './QuoteTemplateEditor';

interface QuoteBasicSectionProps {
  form: QuoteSettings;
  onChangeField: <K extends keyof QuoteSettings>(field: K, value: QuoteSettings[K]) => void;
}

/** 基础设置：默认计费口径与买家回复模板（参数插入 + 实时预览）。 */
const QuoteBasicSection = ({ form, onChangeField }: QuoteBasicSectionProps) => (
  <section className="section-panel" aria-labelledby="basic-settings-title">
    <SectionHeader
      title="基础设置"
      description="默认计费口径与买家回复模板，未识别重量或体积时也能给出明确报价。"
      icon={SlidersHorizontal}
    />
    <div className="grid gap-4 p-4">
      <label className="logistics-check-row">
        <span>
          <span className="block text-sm font-bold text-[var(--text)]">未识别重量/体积时默认按 1kg 计费</span>
          <span className="mt-1 block text-xs leading-relaxed text-[var(--text-muted)]">
            买家询价但无法识别包裹重量或体积时，按 1kg 计算运费，并在回复中说明。
          </span>
        </span>
        <input
          type="checkbox"
          checked={form.defaultOneKg}
          onChange={(event) => onChangeField('defaultOneKg', event.target.checked)}
          aria-label="未识别重量或体积时默认按 1kg 计费"
        />
        <span className="logistics-toggle" aria-hidden="true"><i /></span>
      </label>

      <QuoteTemplateEditor
        id="quote-basic-reply-template"
        label="回复消息自定义"
        value={form.replyTemplate}
        placeholder="用于向买家解释报价与计费口径"
        rows={5}
        sampleValues={buildSampleValues(form, null)}
        onReset={() => onChangeField('replyTemplate', DEFAULT_QUOTE_SETTINGS.replyTemplate)}
        onChange={(value) => onChangeField('replyTemplate', value)}
      />
    </div>
  </section>
);

export default QuoteBasicSection;
