import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, ClipboardCheck, RefreshCw, XCircle } from 'lucide-react';
import {
  listQuoteBooks,
  type LogisticsQuoteBook,
} from '../../services/api';
import { extractParseError } from '../../services/logisticsQuote';
import { loadQuoteReplyTemplates } from '../../services/quoteReply';
import { loadQuoteSettings } from '../../services/quoteSettings';
import { SectionHeader } from '../ui';

type CheckState = 'pass' | 'review' | 'fail';

interface DiagnosticCheck {
  id: string;
  label: string;
  detail: string;
  state: CheckState;
}

const stateMeta: Record<CheckState, { label: string; icon: typeof CheckCircle2; className: string }> = {
  pass: { label: '通过', icon: CheckCircle2, className: 'text-[var(--success)]' },
  review: { label: '待确认', icon: AlertCircle, className: 'text-[var(--warning)]' },
  fail: { label: '未通过', icon: XCircle, className: 'text-[var(--danger)]' },
};

const positiveNumber = (value: string) => Number.isFinite(Number(value)) && Number(value) > 0;

const buildChecks = (books: LogisticsQuoteBook[]): DiagnosticCheck[] => {
  const settings = loadQuoteSettings();
  const templates = loadQuoteReplyTemplates();
  const recognized = books.length > 0 && books.some((book) => book.service_count > 0 && book.route_count > 0);
  const needsReview = books.some((book) => book.payload.source?.status === 'needs_review'
    || (book.payload.warning_count ?? 0) > 0
    || (book.payload.summary?.review ?? 0) > 0
    || (book.payload.summary?.rejected ?? 0) > 0);
  const settingsReady = [
    settings.cardFaceValue,
    settings.platformFaceValue,
    settings.profitMarkup,
    settings.continuedMarkup,
    settings.expressVolumeRatio,
    settings.yimididaVolumeRatio,
    settings.bestVolumeRatioThreshold,
    settings.bestLightVolumeRatio,
    settings.bestHeavyVolumeRatio,
    settings.shunxinOfflineVolumeRatio,
    settings.shunxinOnlineVolumeRatio,
  ].every(positiveNumber) && (settings.scope !== 'custom' || settings.selectedItemKeys.length > 0);
  const templatesReady = Object.values(templates).every((template) => template.trim().length > 0);

  return [
    {
      id: 'source',
      label: '报价表来源',
      state: recognized ? (needsReview ? 'review' : 'pass') : 'fail',
      detail: recognized
        ? `已读取 ${books.length} 份报价表，共 ${books.reduce((total, book) => total + book.route_count, 0)} 条线路${needsReview ? '，存在需要人工确认的字段或解析告警' : ''}`
        : '尚未读取到包含服务和线路的报价表',
    },
    {
      id: 'settings',
      label: '报价设置',
      state: settingsReady ? 'pass' : 'review',
      detail: settingsReady ? '面值、加价、抛比和生效商品配置完整' : '仍有数值参数或生效商品范围需要补充',
    },
    {
      id: 'templates',
      label: '消息模板',
      state: templatesReady ? 'pass' : 'review',
      detail: templatesReady ? '报价、差价、拍下引导和追问文案均已填写' : '存在空白消息模板，发送前需要补充',
    },
    {
      id: 'calculation',
      label: '买家参数',
      state: 'review',
      detail: '需要当前买家的收货地、重量或长宽高后才能计算实际运费',
    },
    {
      id: 'send',
      label: '发送条件',
      state: recognized && !needsReview && settingsReady && templatesReady ? 'review' : 'fail',
      detail: recognized && !needsReview && settingsReady && templatesReady
        ? '来源和配置已就绪，完成买家参数核价后才可发送'
        : '报价来源或配置尚未通过检查，暂不能进入发送',
    },
  ];
};

const QuoteDiagnostics = () => {
  const [books, setBooks] = useState<LogisticsQuoteBook[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [checkedAt, setCheckedAt] = useState<string | null>(null);

  const runDiagnostics = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage('');
    try {
      const response = await listQuoteBooks();
      setBooks(response.books);
      setCheckedAt(new Date().toLocaleString('zh-CN', { hour12: false }));
    } catch (error) {
      setErrorMessage(extractParseError(error));
      setBooks([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void runDiagnostics();
  }, [runDiagnostics]);

  const checks = useMemo(() => buildChecks(books), [books]);
  const passed = checks.filter((check) => check.state === 'pass').length;
  const failed = checks.filter((check) => check.state === 'fail').length;

  return (
    <div className="logistics-page page-stack">
      <section className="section-panel" aria-labelledby="quote-diagnostics-title">
        <SectionHeader
          title="功能检测"
          description="读取已保存的报价表、当前报价设置和消息模板，确认进入实际核价前还缺少什么。"
          icon={ClipboardCheck}
          actions={(
            <button
              type="button"
              className="ios-btn-secondary flex items-center gap-2 rounded-md px-3.5 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-45"
              onClick={() => void runDiagnostics()}
              disabled={isLoading}
            >
              <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
              <span>{isLoading ? '检测中' : '重新检测'}</span>
            </button>
          )}
        />

        {errorMessage && (
          <div className="mx-4 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-[color:color-mix(in_srgb,var(--danger)_34%,var(--border))] bg-[var(--danger-soft)] px-3 py-2.5 text-[13px] text-[var(--danger-ink)]" role="alert">
            <span>{errorMessage}</span>
            <button type="button" className="ios-btn-secondary rounded-md px-3 py-1.5 text-xs" onClick={() => void runDiagnostics()}>
              重试
            </button>
          </div>
        )}

        <div className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <div>
            <p className="text-sm font-bold text-[var(--text)]">
              {isLoading ? '正在读取真实配置…' : `已通过 ${passed}/${checks.length} 项${failed ? `，${failed} 项需要处理` : ''}`}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-[var(--text-muted)]">
              {checkedAt ? `最近检测：${checkedAt}` : '检测结果会随报价表和设置变化而更新'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs text-[var(--text-muted)]">
            <span className="rounded-full bg-[var(--success-soft)] px-2.5 py-1">通过 {passed}</span>
            <span className="rounded-full bg-[var(--warning-soft)] px-2.5 py-1">待确认 {checks.filter((check) => check.state === 'review').length}</span>
            <span className="rounded-full bg-[var(--danger-soft)] px-2.5 py-1">未通过 {failed}</span>
          </div>
        </div>

        <div className="grid gap-2 border-t border-[var(--border)] p-4" aria-live="polite">
          {checks.map((check) => {
            const meta = stateMeta[check.state];
            const Icon = meta.icon;
            return (
              <div className="flex items-start gap-3 rounded-md border border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-2.5" key={check.id}>
                <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${meta.className}`} aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <strong className="text-sm text-[var(--text)]">{check.label}</strong>
                    <span className={`text-xs font-semibold ${meta.className}`}>{meta.label}</span>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-[var(--text-muted)]">{check.detail}</p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="section-panel" aria-labelledby="quote-diagnostics-sources-title">
        <SectionHeader title="检测到的报价来源" description="以下信息来自服务端已保存的识别结果。" icon={ClipboardCheck} />
        <div className="grid gap-3 p-4">
          {books.length === 0 ? (
            <p className="rounded-md border border-dashed border-[var(--border)] px-3 py-4 text-sm text-[var(--text-muted)]">暂无可检测的报价表。</p>
          ) : books.map((book) => (
            <article className="rounded-md border border-[var(--border)] bg-[var(--surface-subtle)] p-3.5" key={book.id}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="min-w-0 truncate text-sm font-bold text-[var(--text)]" title={book.filename}>{book.filename}</h3>
                <span className="text-xs tabular-nums text-[var(--text-muted)]">{book.service_count} 个服务 · {book.route_count} 条线路</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {(book.payload.services ?? []).map((service) => (
                  <span className="rounded-full bg-[var(--surface-strong)] px-2.5 py-1 text-xs text-[var(--text-muted)]" key={`${service.sheet_name}-${service.name}`}>
                    {service.name} · {service.route_count} 条线路
                  </span>
                ))}
              </div>
              {(book.payload.warning_count ?? 0) > 0 && (
                <p className="mt-2 text-xs leading-relaxed text-[var(--warning-ink)]">存在 {book.payload.warning_count} 条解析告警，发送前需要复核。</p>
              )}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
};

export default QuoteDiagnostics;
