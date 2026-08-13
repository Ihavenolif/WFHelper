export interface WfmContractAttribute {
  urlName: string;
  label: string;
  value: number | string | null;
  positive: boolean | null;
}

export interface WfmContract {
  id: string;
  itemName: string;
  itemId: string | null;
  itemUrlName: string | null;
  weaponUrlName: string | null;
  rivenSuffix: string | null;
  itemThumb: string | null;
  platinum: number;
  buyoutPlatinum: number | null;
  startingPlatinum: number | null;
  quantity: number;
  visible: boolean;
  modRank: number | null;
  rerolls: number | null;
  masteryLevel: number | null;
  polarity: string | null;
  minimalReputation: number | null;
  isDirectSell: boolean;
  listedAt: string | null;
  updatedAt: string | null;
  note: string | null;
  stats: WfmContractAttribute[];
  listingUrl: string;
  sourceType: string | null;
}

export interface WfmContractsResult {
  contracts: WfmContract[];
  page: number;
  totalPages: number | null;
  hasMore: boolean;
}

export interface WfmContractsQuery {
  page?: number;
  limit?: number;
}
