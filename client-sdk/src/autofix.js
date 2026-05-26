export async function runAutoFix(client, errorId, { onStep } = {}) {
  const report = (step, detail = '') => onStep?.({ step, detail });

  report('analyze', 'Checking error and running analysis…');
  const analyzeData = await client.analyzeError(errorId);

  if (analyzeData.alreadyGenerated) {
    report(
      'done',
      `Fix already generated (${analyzeData.occurrenceCount ?? '?'} occurrences). PR: ${analyzeData.prUrl}`
    );
    return {
      analysisId: analyzeData.id,
      analyzeData,
      patchData: { cached: true, alreadyGenerated: true },
      prData: {
        prUrl: analyzeData.prUrl,
        prNumber: analyzeData.prNumber,
        cached: true,
        alreadyGenerated: true,
      },
    };
  }

  const analysisId = analyzeData.id;

  report('patch', `Generating patch for analysis #${analysisId}…`);
  const patchData = await client.generatePatch(analysisId);

  if (patchData.alreadyGenerated && patchData.prUrl) {
    report('done', 'Fix already generated for this error.');
    return {
      analysisId: patchData.analysisId || analysisId,
      analyzeData,
      patchData,
      prData: {
        prUrl: patchData.prUrl,
        prNumber: patchData.prNumber,
        cached: true,
        alreadyGenerated: true,
      },
    };
  }

  report('pr', `Creating pull request from analysis #${analysisId}…`);
  const prData = await client.createPullRequest(analysisId);

  report('done', prData.cached ? 'Existing PR found.' : 'Pull request created.');
  return { analysisId, analyzeData, patchData, prData };
}
