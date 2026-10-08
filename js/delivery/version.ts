// Версия поставки — одно число на всё: скиллы, мост, сторожа, расширение. Штампует
// release-please при мерже релизного PR (аннотация ниже, файл в extra-files); руками
// не трогать. Метку канала сборки читает js/build.mjs отсюда и заменяет в выходе
// выпуска буквально (граф @nks/nks-dev, узел #6650).
export const VERSION = "7.4.1"; // x-release-please-version

/** Имя метки канала: другие копии узнаются по `"<имя>:release"` и `"<имя>:dev"` в их тексте. */
export const BUILD_MARK = "iskron-build";

/**
 * Метка канала этой сборки — `BUILD_MARK` и `:dev`; сборка выпуска вшивает `:release`.
 * Форма строки — часть контракта: js/build.mjs находит её регулярным выражением.
 */
export const CHANNEL_MARK: string = "iskron-build:dev";
