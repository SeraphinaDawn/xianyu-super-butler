/**
 * 物流报价计算工具
 *
 * 基于规格文档实现的完整计费逻辑：
 * - 路由计费重与快递/物流分流
 * - 承运商独立抛比计算
 * - 阶梯价 / 首重续重 / minimum_then_per_kg
 * - 加价、折扣与支付计算
 */

export interface LogisticsInput {
  sender?: string;
  receiver?: string;
  weight_kg?: number | null;
  length_cm?: number | null;
  width_cm?: number | null;
  height_cm?: number | null;
  /** 承运商侧支付方式：顺心捷达等按此区分抛比（线下/线上）。 */
  carrier_payment_mode?: 'offline' | 'online';
  quote_config: QuoteConfig;
}

export interface QuoteConfig {
  price_basis?: 'cost' | 'markup';
  carriers: Record<string, CarrierConfig>;
  /** 承运商未在自身配置里指定抛比时套用的默认抛比规则，键为承运商名。 */
  default_volume_ratios?: Record<string, VolumeRatioRule>;
}

/** 按计费重分段的抛比规则：不高于 threshold_kg（含）用 light，否则用 heavy。 */
export interface WeightTieredVolumeRatio {
  basis: 'weight';
  threshold_kg: number;
  light: number;
  heavy: number;
}

/** 按承运商支付方式分段的抛比规则：线下支付用 offline，其余（含未传）用 online。 */
export interface PaymentTieredVolumeRatio {
  basis: 'payment';
  offline: number;
  online: number;
}

/** 抛比规则：固定数值、按计费重分段，或按支付方式分段。 */
export type VolumeRatioRule = number | WeightTieredVolumeRatio | PaymentTieredVolumeRatio;

export interface CarrierConfig {
  volume_ratio?: number;
  price_table: PriceTable;
  markup_cost?: number;
  markup_manual?: number;
  discount_rate?: number;
  discount_amount?: number;
  payment_mode?: 'direct' | 'smart' | 'supplement';
  coupon_max_amount?: number;
  paid_amount?: number;
}

export interface PriceTable {
  // 阶梯价模式
  tiers?: Record<number, number>;
  // 首重续重模式
  first_weight?: number;
  first_weight_price?: number;
  continued_unit?: number;
  continued_weight_price?: number;
  // minimum_then_per_kg 模式
  minimum_price?: number;
  per_kg_price?: number;
}

export interface QuoteResult {
  success: boolean;
  reason?: string;
  missing_fields?: string[];
  route_weight_kg?: number;
  category?: 'express' | 'freight';
  quotes?: CarrierQuote[];
}

export interface CarrierQuote {
  carrier: string;
  volume_ratio: number;
  chargeable_weight_kg: number;
  base_price: number;
  markup_cost: number;
  markup_manual: number;
  discount_rate: number;
  discount_amount: number;
  adjusted_price: number;
  total_price: number;
  payment_mode: string;
  platform_payment: number;
  remaining_payment: number;
}

/**
 * 1. 输入校验
 */
function validateInput(input: LogisticsInput): {
  valid: boolean;
  reason?: string;
  missing_fields?: string[];
  weight?: number;
  hasDimensions?: boolean;
} {
  const { weight_kg, length_cm, width_cm, height_cm, quote_config } = input;

  if (!quote_config) {
    return {
      valid: false,
      reason: 'missing_quote_config',
      missing_fields: ['quote_config'],
    };
  }

  const hasWeight = weight_kg != null && weight_kg > 0;
  const hasDimensions =
    length_cm != null && length_cm > 0 &&
    width_cm != null && width_cm > 0 &&
    height_cm != null && height_cm > 0;

  if (!hasWeight && !hasDimensions) {
    return {
      valid: false,
      reason: 'missing_weight_or_volume',
      missing_fields: ['weight_kg', 'length_cm', 'width_cm', 'height_cm'],
    };
  }

  return {
    valid: true,
    weight: hasWeight ? weight_kg : undefined,
    hasDimensions,
  };
}

/**
 * 2. 路由计费重与快递/物流分流
 */
function calculateRouteWeight(
  weight: number | undefined,
  length_cm: number | null | undefined,
  width_cm: number | null | undefined,
  height_cm: number | null | undefined
): {
  routeWeight: number;
  routeChargeableWeight: number;
  category: 'express' | 'freight';
} {
  const W = weight || 0;

  let volumeWeight = 0;
  if (length_cm && width_cm && height_cm) {
    const volume = length_cm * width_cm * height_cm;
    volumeWeight = volume / 8000; // 路由抛比固定 8000
  }

  const routeWeight = Math.max(W, volumeWeight);
  const routeChargeableWeight = Math.ceil(routeWeight);

  // 路由分流：< 30kg 快递，>= 30kg 物流
  const category: 'express' | 'freight' = routeChargeableWeight < 30 ? 'express' : 'freight';

  return { routeWeight, routeChargeableWeight, category };
}

/**
 * 3. 获取承运商抛比
 *
 * 优先级：承运商自身配置 > default_volume_ratios 设置 > 内置兜底规则。
 * 承运商名先归一（去空白、品牌别名），与报价表里的叫法对齐。
 */
function resolveCarrierKey(carrier: string): string {
  const compact = carrier.replace(/\s+/g, '');
  if (compact.includes('顺心')) return '顺心捷达';
  if (compact === '百世') return '百世快运';
  if (compact === '跨越') return '跨越速运';
  return compact;
}

function getCarrierRatio(
  carrier: string,
  weight: number | undefined,
  config: CarrierConfig,
  defaultRules?: Record<string, VolumeRatioRule>,
  paymentMode?: 'offline' | 'online'
): number {
  // 优先使用配置中的抛比
  if (config.volume_ratio) {
    return config.volume_ratio;
  }

  const W = weight || 0;
  const key = resolveCarrierKey(carrier);

  // 报价设置里配置的默认抛比
  const rule = defaultRules?.[key];
  if (rule != null) {
    if (typeof rule === 'number') return rule;
    if (rule.basis === 'payment') return paymentMode === 'offline' ? rule.offline : rule.online;
    return W <= rule.threshold_kg ? rule.light : rule.heavy;
  }

  // 内置抛比规则（兜底）
  const builtin: Record<string, number | ((w: number) => number)> = {
    普通快递: 8000,
    壹米滴答: 6000,
    百世快运: (w: number) => (w <= 70 ? 7000 : 5000),
    跨越速运: 6000,
    顺心捷达: () => (paymentMode === 'offline' ? 6000 : 5000),
  };

  const ratio = builtin[key];
  if (typeof ratio === 'function') {
    return ratio(W);
  }
  return ratio || 5000;
}

/**
 * 4. 承运商计费重
 */
function calculateCarrierWeight(
  weight: number | undefined,
  length_cm: number | null | undefined,
  width_cm: number | null | undefined,
  height_cm: number | null | undefined,
  carrier: string,
  config: CarrierConfig,
  defaultRules?: Record<string, VolumeRatioRule>,
  paymentMode?: 'offline' | 'online'
): {
  carrierChargeableWeight: number;
  volumeRatio: number;
} {
  const W = weight || 0;
  const ratio = getCarrierRatio(carrier, W, config, defaultRules, paymentMode);

  let volumeWeight = 0;
  if (length_cm && width_cm && height_cm) {
    const volume = length_cm * width_cm * height_cm;
    volumeWeight = volume / ratio;
  }

  const carrierWeight = Math.max(W, volumeWeight);
  const carrierChargeableWeight = Math.ceil(carrierWeight);

  return { carrierChargeableWeight, volumeRatio: ratio };
}

/**
 * 5. 基础运费计算
 */
function calculateBasePrice(chargeableWeight: number, priceTable: PriceTable): number {
  const w = chargeableWeight;

  // 精确阶梯价
  if (priceTable.tiers && priceTable.tiers[w] != null) {
    return priceTable.tiers[w];
  }

  // 首重续重模式
  if (
    priceTable.first_weight_price != null &&
    priceTable.continued_weight_price != null
  ) {
    const firstWeight = priceTable.first_weight ?? 1;
    const continuedUnit = priceTable.continued_unit ?? 1;
    const exceeding = Math.max(0, w - firstWeight);
    const continuedCount = Math.ceil(exceeding / continuedUnit);
    return priceTable.first_weight_price + continuedCount * priceTable.continued_weight_price;
  }

  // minimum_then_per_kg 模式
  if (priceTable.minimum_price != null && priceTable.per_kg_price != null) {
    return Math.max(priceTable.minimum_price, w * priceTable.per_kg_price);
  }

  throw new Error('price_table_invalid: 报价表模型不完整');
}

/**
 * 6. 加价与折扣
 */
function applyAdjustments(
  basePrice: number,
  config: CarrierConfig,
  globalPriceBasis?: 'cost' | 'markup'
): {
  markup_cost: number;
  markup_manual: number;
  discount_rate: number;
  discount_amount: number;
  adjusted_price: number;
  total_price: number;
} {
  const M_cost = globalPriceBasis === 'cost' ? (config.markup_cost || 0) : 0;
  const M_manual = config.markup_manual || 0;
  const R = Math.max(0, Math.min(100, config.discount_rate || 0));
  const D = Math.max(0, config.discount_amount || 0);

  const adjusted = Math.max(0, basePrice + M_cost + M_manual);
  const total = Math.max(0, adjusted * (1 - R / 100) - D);

  return {
    markup_cost: M_cost,
    markup_manual: M_manual,
    discount_rate: R,
    discount_amount: D,
    adjusted_price: adjusted,
    total_price: total,
  };
}

/**
 * 7. 支付计算
 */
function calculatePayment(
  totalPrice: number,
  config: CarrierConfig
): {
  payment_mode: string;
  platform_payment: number;
  remaining_payment: number;
} {
  const mode = config.payment_mode || 'direct';
  const C = config.coupon_max_amount || 0;

  let platformPayment = 0;

  switch (mode) {
    case 'direct':
      platformPayment = totalPrice;
      break;
    case 'smart':
      platformPayment = Math.min(totalPrice, C);
      break;
    case 'supplement':
      platformPayment = config.paid_amount || 0;
      break;
    default:
      platformPayment = totalPrice;
  }

  const remaining = Math.max(0, totalPrice - platformPayment);

  return {
    payment_mode: mode,
    platform_payment: platformPayment,
    remaining_payment: remaining,
  };
}

/**
 * 主计算函数
 */
export function calculateLogisticsQuote(input: LogisticsInput): QuoteResult {
  // 1. 校验输入
  const validation = validateInput(input);
  if (!validation.valid) {
    return {
      success: false,
      reason: validation.reason,
      missing_fields: validation.missing_fields,
    };
  }

  // 2. 路由计费重与分流
  const { weight_kg, length_cm, width_cm, height_cm, quote_config } = input;
  const { routeChargeableWeight, category } = calculateRouteWeight(
    validation.weight,
    length_cm,
    width_cm,
    height_cm
  );

  // 3. 遍历承运商计算
  const carriers = quote_config.carriers || {};
  const quotes: CarrierQuote[] = [];

  for (const [carrierName, carrierConfig] of Object.entries(carriers)) {
    try {
      const { carrierChargeableWeight, volumeRatio } = calculateCarrierWeight(
        validation.weight,
        length_cm,
        width_cm,
        height_cm,
        carrierName,
        carrierConfig,
        quote_config.default_volume_ratios,
        input.carrier_payment_mode
      );

      const priceTable = carrierConfig.price_table;
      const basePrice = calculateBasePrice(carrierChargeableWeight, priceTable);

      const adjustments = applyAdjustments(
        basePrice,
        carrierConfig,
        quote_config.price_basis
      );

      const payment = calculatePayment(adjustments.total_price, carrierConfig);

      quotes.push({
        carrier: carrierName,
        volume_ratio: volumeRatio,
        chargeable_weight_kg: carrierChargeableWeight,
        base_price: Math.round(basePrice * 100) / 100,
        ...adjustments,
        ...payment,
      });
    } catch (error) {
      console.error(`承运商 ${carrierName} 计算失败:`, error);
    }
  }

  return {
    success: true,
    route_weight_kg: routeChargeableWeight,
    category,
    quotes,
  };
}
