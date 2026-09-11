import { describe, expect, it } from "vitest";
import { parseApiRelease } from "../src/tools/core/api_release_state.js";

// Recorte del documento real de DEV_B para BAPI_SALESORDER_CREATEFROMDAT2.
const XML = `<ars:apiRelease><atom:link href="/sap/bc/adt/apireleases/x/c0" rel="self" type="t" title="API Release Contract"/>
<ars:status ars:state="RELEASED" ars:stateDescription="Released"/><ars:successors><ars:successor adtcore:uri="/sap/bc/adt/bo/behaviordefinitions/i_salesordertp" adtcore:type="BDEF/BDO" adtcore:name="I_SALESORDERTP"/></ars:successors><ars:successorConceptName/>
<atom:link href="/sap/bc/adt/apireleases/x/c1" rel="self" type="t" title="API Release Contract"/>
<ars:status ars:state="NOT_TO_BE_RELEASED" ars:stateDescription="Not to Be Released"/><ars:successors/><ars:successorConceptName/></ars:apiRelease>`;

describe("parseApiRelease", () => {
  it("estado y sucesor por contrato", () => {
    const r = parseApiRelease(XML);
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ contract: "C0 extensión", state: "Released (RELEASED)", successors: ["I_SALESORDERTP (BDEF/BDO)"] });
    expect(r[1]).toMatchObject({ state: "Not to Be Released (NOT_TO_BE_RELEASED)", successors: [] });
  });
});
