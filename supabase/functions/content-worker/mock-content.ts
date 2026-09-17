import type {
  ContentProvider,
} from "./content-provider.ts";

export const generateMockContent: ContentProvider = (
  input,
) => {
  const title = `${input.title}: обзор возможностей`;
  const evidence = input.research_answer ??
    "Исследовательское резюме отсутствует.";

  return Promise.resolve({
    title,
    body: [
      `# ${title}`,
      "",
      `Исходный сервис: ${input.url}`,
      "",
      `Регион: ${input.region}. Язык: ${input.language}.`,
      "",
      "## Что показало исследование",
      "",
      evidence,
      "",
      "## Следующий шаг",
      "",
      `Рекомендация: ${input.recommendation}.`,
    ].join("\n"),
    excerpt:
      `Обзор ${input.title} на основе проверенных исследовательских данных.`,
    meta_title: title,
    meta_description:
      `Возможности ${input.title}, результаты исследования и доступные программы рекомендаций.`,
  });
};
