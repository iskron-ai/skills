// Граница поддержки выравнивания (граф @nks/nks-dev, узел #9786).
export const CONTRACT_SUPPORT = { minimum: 39, target: 42 } as const;

export const CONTRACT_WORDS = {
  ru: {
    unsupported: (n: number, target: number): string =>
      `Контракт ${n} больше не поддерживается; старые хуки не удалены. Выполните полный прогон iskronify до ${target}; ритуалы будут приняты после проверки`,
  },
  en: {
    unsupported: (n: number, target: number): string =>
      `Contract ${n} is no longer supported; old hooks have not been removed. Run a full iskronify pass to ${target}; rituals will be accepted after verification`,
  },
};
