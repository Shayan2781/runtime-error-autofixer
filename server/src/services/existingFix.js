// Look up an existing fix (analysis + patch + PR) for a deduplicated error group.
export function findExistingFixForGroup(analysisDAO, errorGroupDAO, groupId) {
  if (!groupId) {
    return null;
  }

  const analysis = analysisDAO.getLatestFixByGroupId(groupId);
  if (!analysis?.patch_unified_diff || !analysis.pr_url) {
    return null;
  }

  const group = errorGroupDAO.getById(groupId);

  return {
    analysis,
    group,
    pr: {
      id: analysis.pr_id,
      url: analysis.pr_url,
      number: analysis.pr_number,
      status: analysis.pr_status,
    },
  };
}

export function buildExistingFixPayload(existingFix, errorEventId) {
  const { analysis, group, pr } = existingFix;

  return {
    id: analysis.id,
    analysisId: analysis.id,
    errorEventId,
    errorGroupId: analysis.error_group_id,
    status: analysis.status,
    suggestionSummary: analysis.suggestion_summary,
    suggestionFull: analysis.suggestion_full,
    model: analysis.llm_model,
    patch: analysis.patch_unified_diff,
    alreadyGenerated: true,
    message: 'Fix already generated for this error',
    prUrl: pr.url,
    prNumber: pr.number,
    prStatus: pr.status,
    occurrenceCount: group?.occurrence_count ?? null,
    cached: true,
  };
}
