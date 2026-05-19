import { Card, CardContent } from "@/components/ui/card";

export interface QuickStatsStripData {
  week: number;
  month: number;
  year: number;
  allTime: number;
}

export function QuickStatsStrip({ data }: { data: QuickStatsStripData }) {
  return (
    <Card>
      <CardContent className="grid grid-cols-4 gap-2 py-3 text-center">
        <Stat label="This week" value={data.week} />
        <Stat label="This month" value={data.month} />
        <Stat label="This year" value={data.year} />
        <Stat label="All time" value={data.allTime} />
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-lg font-bold">{value}</p>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
    </div>
  );
}
