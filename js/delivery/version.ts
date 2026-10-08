// Версия поставки — одно число на всё: скиллы, мост, сторожа, расширение. Штампует
// release-please при мерже релизного PR (аннотация ниже, файл в extra-files); руками
// не трогать. Метку канала сборки читает js/build.mjs отсюда и заменяет в выходе
// выпуска буквально (граф @nks/nks-dev, узел #6650).
export const VERSION = "7.4.1"; // x-release-please-version

/** Метка канала сборки: `<имя>-build:dev`; сборка выпуска вшивает `:release` на место `:dev`. */
export const CHANNEL_MARK: string = "iskron-build:dev";
