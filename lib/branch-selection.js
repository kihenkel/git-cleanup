const answerMeansDelete = (answer) => {
  const normalized = String(answer || '').trim().toLowerCase();
  return normalized === 'y' || normalized === 'yes';
};

const selectLocalOnlyBranches = async (branches, askToDelete, { isInteractive = true } = {}) => {
  if (!isInteractive) {
    return {
      toDelete: [],
      toKeep: [...branches],
    };
  }

  const toDelete = [];
  const toKeep = [];

  for (const branch of branches) {
    if (await askToDelete(branch)) {
      toDelete.push(branch);
    } else {
      toKeep.push(branch);
    }
  }

  return { toDelete, toKeep };
};

module.exports = {
  answerMeansDelete,
  selectLocalOnlyBranches,
};
