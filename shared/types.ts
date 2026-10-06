// 서버와 브라우저가 함께 쓰는 타입. 이 폴더는 비밀값·DB 접근 코드를 두지 않는다.
export interface Money {
  value: string;
  currency: string;
}

// Browse API item_summary / item 응답 중 이 앱이 쓰는 필드만 정의한다.
export interface RawItemSummary {
  itemId: string;
  title: string;
  price: Money;
  itemWebUrl?: string;
  image?: { imageUrl: string };
  condition?: string;
  conditionId?: string;
  buyingOptions?: string[];
  shippingOptions?: { shippingCost?: Money }[];
  itemLocation?: { country?: string };
  categoryId?: string;
  legacyItemId?: string;
  localizedAspects?: { name: string; value: string }[];
  itemEndDate?: string;
}

export type Provenance = 'api_aspect' | 'api_condition' | 'title_rule' | 'manual';
