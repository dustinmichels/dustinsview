const isDraft = (data) => Boolean(data.draft);
const shouldShowDraft = () => process.env.BUILD_DRAFTS === "true";

export default {
  eleventyComputed: {
    eleventyExcludeFromCollections: (data) => {
      if (isDraft(data) && !shouldShowDraft()) {
        return true;
      }
      return data.eleventyExcludeFromCollections;
    },
    permalink: (data) => {
      if (isDraft(data) && !shouldShowDraft()) {
        return false;
      }
      return data.permalink;
    },
  },
};
