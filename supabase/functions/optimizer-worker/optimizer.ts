export type OptimizationAction =
  | "skip"
  | "collect_more_data"
  | "improve_content"
  | "monitor"
  | "scale_content";

export type OptimizationSnapshot = {
  content_id: string;
  referral_link_id: string;
  content_status: string;
  referral_link_status: string;
  clicks: number;
  conversions: number;
  revenue: number | string;
};

export type OptimizationPolicy = {
  minimum_clicks: number;
  winner_conversion_rate: number;
  minimum_winner_revenue: number;
};

export type OptimizationDecision = {
  content_id: string;
  referral_link_id: string;
  action: OptimizationAction;
  reason: string;
  priority: number;
  conversion_rate: number;
  metrics: {
    clicks: number;
    conversions: number;
    revenue: number;
  };
};

export const defaultOptimizationPolicy: OptimizationPolicy = {
  minimum_clicks: 20,
  winner_conversion_rate: 0.05,
  minimum_winner_revenue: 1,
};

function requiredString(
  value: string,
  field: string,
): string {
  const normalized = value.trim();

  if (!normalized) {
    throw new Error(`${field} is required`);
  }

  return normalized;
}

function nonNegativeInteger(
  value: number,
  field: string,
): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative integer`);
  }

  return value;
}

function nonNegativeNumber(
  value: number | string,
  field: string,
): number {
  const normalized = Number(value);

  if (!Number.isFinite(normalized) || normalized < 0) {
    throw new Error(`${field} must be a non-negative number`);
  }

  return Number(normalized.toFixed(2));
}

function validatePolicy(
  policy: OptimizationPolicy,
): OptimizationPolicy {
  const minimumClicks = nonNegativeInteger(
    policy.minimum_clicks,
    "Optimization minimum clicks",
  );
  const winnerConversionRate = Number(
    policy.winner_conversion_rate,
  );
  const minimumWinnerRevenue = nonNegativeNumber(
    policy.minimum_winner_revenue,
    "Optimization minimum winner revenue",
  );

  if (
    !Number.isFinite(winnerConversionRate) ||
    winnerConversionRate <= 0 ||
    winnerConversionRate > 1
  ) {
    throw new Error(
      "Optimization winner conversion rate must be between 0 and 1",
    );
  }

  if (minimumClicks === 0) {
    throw new Error(
      "Optimization minimum clicks must be positive",
    );
  }

  return {
    minimum_clicks: minimumClicks,
    winner_conversion_rate: winnerConversionRate,
    minimum_winner_revenue: minimumWinnerRevenue,
  };
}

export function evaluateOptimization(
  snapshot: OptimizationSnapshot,
  policy: OptimizationPolicy = defaultOptimizationPolicy,
): OptimizationDecision {
  const normalizedPolicy = validatePolicy(policy);
  const contentId = requiredString(
    snapshot.content_id,
    "Optimization content id",
  );
  const referralLinkId = requiredString(
    snapshot.referral_link_id,
    "Optimization referral link id",
  );
  const clicks = nonNegativeInteger(
    snapshot.clicks,
    "Optimization clicks",
  );
  const conversions = nonNegativeInteger(
    snapshot.conversions,
    "Optimization conversions",
  );
  const revenue = nonNegativeNumber(
    snapshot.revenue,
    "Optimization revenue",
  );

  if (conversions > clicks) {
    throw new Error(
      "Optimization conversions cannot exceed clicks",
    );
  }

  const conversionRate = clicks === 0
    ? 0
    : Number((conversions / clicks).toFixed(4));
  const metrics = { clicks, conversions, revenue };
  const base = {
    content_id: contentId,
    referral_link_id: referralLinkId,
    conversion_rate: conversionRate,
    metrics,
  };

  if (
    snapshot.content_status !== "published" ||
    snapshot.referral_link_status !== "active"
  ) {
    return {
      ...base,
      action: "skip",
      reason: "Content or referral link is not eligible",
      priority: 0,
    };
  }

  if (clicks < normalizedPolicy.minimum_clicks) {
    return {
      ...base,
      action: "collect_more_data",
      reason: "Minimum click sample has not been reached",
      priority: 10,
    };
  }

  if (conversions === 0) {
    return {
      ...base,
      action: "improve_content",
      reason: "Qualified traffic has no conversions",
      priority: 80,
    };
  }

  if (
    conversionRate >=
      normalizedPolicy.winner_conversion_rate &&
    revenue >= normalizedPolicy.minimum_winner_revenue
  ) {
    return {
      ...base,
      action: "scale_content",
      reason: "Conversion and revenue thresholds were reached",
      priority: 60,
    };
  }

  return {
    ...base,
    action: "monitor",
    reason: "Performance is valid but below scaling thresholds",
    priority: 30,
  };
}

export function rankOptimizationDecisions(
  snapshots: OptimizationSnapshot[],
  policy: OptimizationPolicy = defaultOptimizationPolicy,
): OptimizationDecision[] {
  return snapshots
    .map((snapshot) =>
      evaluateOptimization(snapshot, policy)
    )
    .sort((left, right) =>
      right.priority - left.priority ||
      left.content_id.localeCompare(right.content_id) ||
      left.referral_link_id.localeCompare(
        right.referral_link_id,
      )
    );
}
