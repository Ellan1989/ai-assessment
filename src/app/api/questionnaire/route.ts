import { QUESTIONNAIRE_V1 } from "@/lib/questionnaire/v1";
import { jsonOk } from "@/lib/security";

export async function GET() {
  return jsonOk({ questionnaire: QUESTIONNAIRE_V1 });
}
