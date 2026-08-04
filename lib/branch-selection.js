const answerMeansDelete = (answer) => {
  const normalized = String(answer || '').trim().toLowerCase();
  return normalized !== 'n' && normalized !== 'no';
};

const selectLocalOnlyBranches = async (branches, askToDelete) => {
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
