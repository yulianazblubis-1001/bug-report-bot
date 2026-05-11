import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Zap,
  Upload,
  CheckCircle2,
  AlertTriangle,
  ArrowLeft,
  FileText,
  X,
} from "lucide-react";
import { Link } from "wouter";

interface Agronomist {
  phoneNumber: string;
  name: string;
  area: string;
}

interface FarmerRecord {
  fgName: string;
  farmerName: string;
}

type CreditLimitType = "standard" | "largeFarmer";
type CreditType = "Agri Input" | "Mechanization" | "Agri Input + Mechanization";

interface FormState {
  reporterPhone: string;
  creditLimitType: CreditLimitType;
  fgName: string;
  farmerName: string;
  landSizeVerified: string;
  currentLimit: string;
  requestedTopUp: string;
  creditType: CreditType | "";
  reason: string;
  soNumber: string;
  // Large farmer fields
  farmerIncomeSources: string;
  businessPotential: string;
  collateralType: string;
  creditLimitRequestAmount: string;
}

interface FormFiles {
  docSignedSO: File[];
  docFarmerHolding: File[];
  docLandOwnership: File[];
  docJaminan: File[];
  docSurveyPhotoTM: File[];
}

const INITIAL_FORM: FormState = {
  reporterPhone: "",
  creditLimitType: "standard",
  fgName: "",
  farmerName: "",
  landSizeVerified: "",
  currentLimit: "",
  requestedTopUp: "",
  creditType: "",
  reason: "",
  soNumber: "",
  farmerIncomeSources: "",
  businessPotential: "",
  collateralType: "",
  creditLimitRequestAmount: "",
};

const INITIAL_FILES: FormFiles = {
  docSignedSO: [],
  docFarmerHolding: [],
  docLandOwnership: [],
  docJaminan: [],
  docSurveyPhotoTM: [],
};

async function compressImage(file: File, maxPx = 1920, quality = 0.82): Promise<File> {
  if (!file.type.startsWith('image/')) return file;
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.onload = () => {
      URL.revokeObjectURL(url);
      const { width, height } = img;
      const ratio = Math.min(1, maxPx / width, maxPx / height);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => {
          if (blob) {
            const name = file.name.replace(/\.[^.]+$/, '.jpg');
            resolve(new File([blob], name, { type: 'image/jpeg' }));
          } else {
            resolve(file);
          }
        },
        'image/jpeg',
        quality
      );
    };
    img.src = url;
  });
}

function ComboboxField({
  label,
  value,
  onChange,
  options,
  placeholder,
  disabled,
  error,
  required,
  testId,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
  disabled?: boolean;
  error?: string;
  required?: boolean;
  testId?: string;
}) {
  const [inputValue, setInputValue] = useState(value);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setInputValue(value);
  }, [value]);

  const filtered =
    inputValue.length >= 3
      ? options.filter((o) => o.toLowerCase().includes(inputValue.toLowerCase()))
      : [];

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    setInputValue(v);
    // Only clear the form value when the user types something different from the current selection
    if (v !== value) onChange("");
    setOpen(v.length >= 3 && options.length > 0);
  }

  function handleSelect(opt: string) {
    setInputValue(opt);
    onChange(opt);
    setOpen(false);
  }

  function handleBlur() {
    setTimeout(() => {
      setOpen(false);
      // Auto-select when the typed text is an exact case-insensitive match
      if (!value && inputValue.trim().length > 0) {
        const exact = options.find(
          (o) => o.toLowerCase() === inputValue.trim().toLowerCase()
        );
        if (exact) {
          setInputValue(exact);
          onChange(exact);
        }
      }
    }, 150);
  }

  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      <div className="relative">
        <input
          data-testid={testId}
          type="text"
          value={inputValue}
          onChange={handleChange}
          onFocus={() => { if (inputValue.length >= 3 && filtered.length > 0) setOpen(true); }}
          onBlur={handleBlur}
          disabled={disabled}
          placeholder={
            disabled ? "— Pilih FG dulu —" : (placeholder ?? "Ketik min. 3 huruf…")
          }
          className="w-full p-2.5 bg-background border rounded-md text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none disabled:opacity-50 disabled:cursor-not-allowed"
        />
        {open && filtered.length > 0 && (
          <ul className="absolute z-50 w-full mt-1 max-h-60 overflow-y-auto bg-background border rounded-md shadow-lg">
            {filtered.map((opt) => (
              <li
                key={opt}
                onMouseDown={() => handleSelect(opt)}
                className="px-3 py-2 text-sm cursor-pointer hover:bg-muted"
              >
                {opt}
              </li>
            ))}
          </ul>
        )}
        {open && inputValue.length >= 3 && filtered.length === 0 && (
          <div className="absolute z-50 w-full mt-1 bg-background border rounded-md shadow-lg px-3 py-2 text-sm text-muted-foreground">
            Tidak ada hasil untuk "{inputValue}"
          </div>
        )}
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}

function FileUploadField({
  label,
  fieldName,
  fileList,
  onFilesChange,
  required,
}: {
  label: string;
  fieldName: keyof FormFiles;
  fileList: File[];
  onFilesChange: (field: keyof FormFiles, files: File[]) => void;
  required?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  function addFiles(newFiles: FileList | null) {
    if (!newFiles) return;
    const combined = [...fileList, ...Array.from(newFiles)];
    onFilesChange(fieldName, combined);
    if (inputRef.current) inputRef.current.value = "";
  }

  function removeFile(index: number) {
    const updated = fileList.filter((_, i) => i !== index);
    onFilesChange(fieldName, updated);
  }

  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      {fileList.length > 0 && (
        <div className="space-y-1.5">
          {fileList.map((file, i) => (
            <div key={`${file.name}-${i}`} className="flex items-center gap-2 p-2.5 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 rounded-md">
              <FileText className="w-4 h-4 text-emerald-600 flex-shrink-0" />
              <span className="text-sm truncate flex-1">{file.name}</span>
              <span className="text-xs text-muted-foreground">
                {(file.size / 1024).toFixed(0)} KB
              </span>
              <button
                type="button"
                onClick={() => removeFile(i)}
                className="p-1 hover:bg-red-100 dark:hover:bg-red-900/20 rounded"
              >
                <X className="w-3.5 h-3.5 text-red-500" />
              </button>
            </div>
          ))}
        </div>
      )}
      <div
        onClick={() => inputRef.current?.click()}
        className="flex items-center justify-center gap-2 p-4 border-2 border-dashed rounded-md cursor-pointer hover:border-primary/50 hover:bg-muted/30 transition-colors"
      >
        <Upload className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm text-muted-foreground">
          {fileList.length > 0 ? "Add more files" : "Click to upload"}
        </span>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*,.pdf,.doc,.docx"
        multiple
        className="hidden"
        onChange={(e) => addFiles(e.target.files)}
      />
    </div>
  );
}

export default function CreditLimitForm() {
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [files, setFiles] = useState<FormFiles>(INITIAL_FILES);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ success: boolean; requestId?: string; error?: string; code?: string; logId?: string; warnings?: string[] } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [prefilled, setPrefilled] = useState(false);

  const { data: agronomists } = useQuery<Agronomist[]>({
    queryKey: ["/api/agronomists"],
    staleTime: 60000,
  });

  const { data: farmerDb = [] } = useQuery<FarmerRecord[]>({
    queryKey: ["/api/farmers"],
    staleTime: 300000,
  });

  const fgOptions = [...new Set(farmerDb.map((f) => f.fgName))].sort();
  const farmerOptions = form.fgName
    ? farmerDb.filter((f) => f.fgName === form.fgName).map((f) => f.farmerName).sort()
    : [];

  // Auto-fill from URL params (sent by WhatsApp bot)
  useEffect(() => {
    if (prefilled || !agronomists) return;
    const params = new URLSearchParams(window.location.search);
    const phone = params.get("phone");
    const type = params.get("type");

    if (phone) {
      const match = agronomists.find((a) => a.phoneNumber === phone);
      if (match) {
        setForm((prev) => ({
          ...prev,
          reporterPhone: phone,
          creditLimitType: (type === "largeFarmer" ? "largeFarmer" : "standard") as CreditLimitType,
        }));
        setPrefilled(true);
      }
    }
  }, [agronomists, prefilled]);

  const selectedAgronomist = agronomists?.find((a) => a.phoneNumber === form.reporterPhone);

  const isLargeFarmer = form.creditLimitType === "largeFarmer";
  const includesAgriInput = form.creditType.includes("Agri Input");
  const includesMechanization = form.creditType.includes("Mechanization");

  function updateForm(field: keyof FormData, value: string) {
    setForm((prev) => {
      const next = { ...prev, [field]: value };
      // Clear farmer when FG changes
      if (field === "fgName") next.farmerName = "";
      return next;
    });
    if (errors[field]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  }

  function updateFiles(field: keyof FormFiles, fileList: File[]) {
    setFiles((prev) => ({ ...prev, [field]: fileList }));
  }

  function validate(): boolean {
    const errs: Record<string, string> = {};

    if (!form.reporterPhone) errs.reporterPhone = "Please select your name";
    if (!form.fgName) errs.fgName = "FG name is required";
    if (!form.farmerName) errs.farmerName = "Farmer name is required";
    if (!form.landSizeVerified) errs.landSizeVerified = "Land size is required";
    if (!form.currentLimit) errs.currentLimit = "Current limit is required";
    if (!form.requestedTopUp) errs.requestedTopUp = "Requested top-up is required";
    if (!form.creditType) errs.creditType = "Credit type is required";
    if (!form.reason) errs.reason = "Reason is required";

    // Validate land size for standard vs large farmer
    const landSize = parseFloat(form.landSizeVerified);
    if (!isNaN(landSize)) {
      if (form.creditLimitType === "standard" && landSize > 2.5) {
        errs.landSizeVerified = "Land > 2.5 Ha must use Petani Besar type";
      }
      if (form.creditLimitType === "largeFarmer" && landSize <= 2.5) {
        errs.landSizeVerified = "Land ≤ 2.5 Ha should use Standard type";
      }
      if (landSize > 5) {
        errs.landSizeVerified = "Maximum land size is 5 Ha";
      }
    }

    // Large farmer extra fields
    if (isLargeFarmer) {
      if (!form.farmerIncomeSources) errs.farmerIncomeSources = "Income sources is required for large farmer";
      if (!form.collateralType) errs.collateralType = "Collateral type is required for large farmer";
    }

    // SO number for Agri Input
    if (includesAgriInput && !form.soNumber) {
      errs.soNumber = "SO number is required for Agri Input";
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    setSubmitting(true);
    setResult(null);

    try {
      const formData = new FormData();

      // Add text fields
      Object.entries(form).forEach(([key, value]) => {
        if (value) formData.append(key, value);
      });

      // Compress images then add files
      for (const [key, fileList] of Object.entries(files)) {
        if (Array.isArray(fileList)) {
          for (const file of fileList) {
            const compressed = await compressImage(file);
            formData.append(key, compressed);
          }
        }
      }

      const res = await fetch("/api/credit-limit/submit", {
        method: "POST",
        body: formData,
      });

      // Read as text first to avoid unreadable JSON parse errors
      const text = await res.text();
      let data: any;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(`Server error (HTTP ${res.status}): ${text.substring(0, 300)}`);
      }

      if (res.ok && data.success) {
        setResult({
          success: true,
          requestId: data.requestId,
          logId: data.logId,
          warnings: data.warnings,
        });
        setForm(INITIAL_FORM);
        setFiles(INITIAL_FILES);
      } else {
        setResult({
          success: false,
          error: data.error || "Something went wrong",
          code: data.code,
          logId: data.logId,
        });
      }
    } catch (err: any) {
      setResult({ success: false, error: err.message || "Network error" });
    } finally {
      setSubmitting(false);
    }
  }

  function handleReset() {
    setForm(INITIAL_FORM);
    setFiles(INITIAL_FILES);
    setErrors({});
    setResult(null);
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4 flex items-center gap-3">
          <Link href="/">
            <button className="p-2 rounded-md hover:bg-muted transition-colors">
              <ArrowLeft className="w-4 h-4" />
            </button>
          </Link>
          <div className="w-9 h-9 rounded-md bg-primary flex items-center justify-center">
            <Zap className="w-5 h-5 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">
              Credit Limit Top Up
            </h1>
            <p className="text-xs text-muted-foreground">
              Submit request via form — faster than chat
            </p>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
        {/* Success message */}
        {result?.success && (
          <Card className="mb-6 border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20">
            <CardContent className="p-5">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-medium text-emerald-800 dark:text-emerald-200">
                    Request submitted!
                  </p>
                  <p className="text-sm text-emerald-700 dark:text-emerald-300 mt-1">
                    Request ID: <strong>{result.requestId}</strong>
                  </p>
                  <p className="text-sm text-emerald-600 dark:text-emerald-400 mt-1">
                    Ops Excellence team has been notified on Slack. You'll get a WhatsApp message when it's approved or rejected.
                  </p>
                  {result.warnings && result.warnings.length > 0 && (
                    <div className="mt-2 p-2 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded text-xs text-amber-700 dark:text-amber-300">
                      <p className="font-medium">Warnings:</p>
                      {result.warnings.map((w, i) => (
                        <p key={i}>• {w}</p>
                      ))}
                    </div>
                  )}
                  <button
                    onClick={handleReset}
                    className="mt-3 text-sm font-medium text-emerald-700 hover:text-emerald-900 dark:text-emerald-300 underline"
                  >
                    Submit another request
                  </button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Error message */}
        {result && !result.success && (
          <Card className="mb-6 border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-950/20">
            <CardContent className="p-5">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-medium text-red-800 dark:text-red-200">
                    Failed to submit
                  </p>
                  <p className="text-sm text-red-600 dark:text-red-400 mt-1">
                    {result.error}
                  </p>
                  {result.code && (
                    <p className="text-xs text-red-500 dark:text-red-400 mt-1 font-mono">
                      Error: {result.code} {result.logId && `| Log ID: ${result.logId}`}
                    </p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Form */}
        {!result?.success && (
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Section 1: Reporter */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">1. Your Info</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">
                    Your Name <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={form.reporterPhone}
                    onChange={(e) => updateForm("reporterPhone", e.target.value)}
                    className="w-full p-2.5 bg-background border rounded-md text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                  >
                    <option value="">— Select your name —</option>
                    {agronomists
                      ?.sort((a, b) => a.name.localeCompare(b.name))
                      .map((a) => (
                        <option key={a.phoneNumber} value={a.phoneNumber}>
                          {a.name} — {a.area}
                        </option>
                      ))}
                  </select>
                  {errors.reporterPhone && (
                    <p className="text-xs text-red-500">{errors.reporterPhone}</p>
                  )}
                  {selectedAgronomist && (
                    <p className="text-xs text-muted-foreground">
                      Area: {selectedAgronomist.area}
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Section 2: Request Type */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">2. Request Type</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => updateForm("creditLimitType", "standard")}
                    className={`p-4 rounded-md border-2 text-left transition-colors ${
                      form.creditLimitType === "standard"
                        ? "border-primary bg-primary/5"
                        : "border-muted hover:border-primary/30"
                    }`}
                  >
                    <p className="text-sm font-medium">Standard</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Lahan &lt; 2.5 Ha
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => updateForm("creditLimitType", "largeFarmer")}
                    className={`p-4 rounded-md border-2 text-left transition-colors ${
                      form.creditLimitType === "largeFarmer"
                        ? "border-primary bg-primary/5"
                        : "border-muted hover:border-primary/30"
                    }`}
                  >
                    <p className="text-sm font-medium">Petani Besar</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Lahan &gt; 2.5 Ha s/d 5 Ha
                    </p>
                  </button>
                </div>
              </CardContent>
            </Card>

            {/* Section 3: Farmer Data */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">3. Farmer Data</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <ComboboxField
                    label="Farmer Group (FG)"
                    value={form.fgName}
                    onChange={(v) => updateForm("fgName", v)}
                    options={fgOptions}
                    placeholder={fgOptions.length === 0 ? "Loading…" : "Ketik min. 3 huruf FG…"}
                    error={errors.fgName}
                    required
                    testId="input-fg-name"
                  />
                  <ComboboxField
                    label="Farmer Name"
                    value={form.farmerName}
                    onChange={(v) => updateForm("farmerName", v)}
                    options={farmerOptions}
                    disabled={!form.fgName}
                    error={errors.farmerName}
                    required
                    testId="input-farmer-name"
                  />
                </div>

                <InputField
                  label="Land Size (Ha)"
                  value={form.landSizeVerified}
                  onChange={(v) => updateForm("landSizeVerified", v)}
                  error={errors.landSizeVerified}
                  placeholder="e.g. 1.5"
                  type="number"
                  step="0.1"
                  required
                />

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <InputField
                    label="Current Limit (IDR)"
                    value={form.currentLimit}
                    onChange={(v) => updateForm("currentLimit", v)}
                    error={errors.currentLimit}
                    placeholder="e.g. 5000000"
                    required
                  />
                  <InputField
                    label="Requested Top-Up (IDR)"
                    value={form.requestedTopUp}
                    onChange={(v) => updateForm("requestedTopUp", v)}
                    error={errors.requestedTopUp}
                    placeholder="e.g. 10000000"
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium">
                    Credit Type <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={form.creditType}
                    onChange={(e) => updateForm("creditType", e.target.value)}
                    className="w-full p-2.5 bg-background border rounded-md text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                  >
                    <option value="">— Select credit type —</option>
                    <option value="Agri Input">Agri Input</option>
                    <option value="Mechanization">Mechanization</option>
                    <option value="Agri Input + Mechanization">Both (Agri Input + Mechanization)</option>
                  </select>
                  {errors.creditType && (
                    <p className="text-xs text-red-500">{errors.creditType}</p>
                  )}
                </div>

                {includesAgriInput && (
                  <InputField
                    label="SO Number"
                    value={form.soNumber}
                    onChange={(v) => updateForm("soNumber", v)}
                    error={errors.soNumber}
                    placeholder="e.g. SO-12345"
                    required
                  />
                )}

                <div className="space-y-1.5">
                  <label className="text-sm font-medium">
                    Reason / Alasan <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    value={form.reason}
                    onChange={(e) => updateForm("reason", e.target.value)}
                    rows={3}
                    className="w-full p-2.5 bg-background border rounded-md text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none resize-none"
                    placeholder="Why does this farmer need a credit limit increase?"
                  />
                  {errors.reason && (
                    <p className="text-xs text-red-500">{errors.reason}</p>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Section 4: Large Farmer Extra (conditional) */}
            {isLargeFarmer && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    4. Petani Besar Info
                    <Badge variant="secondary" className="text-[10px]">Large Farmer</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">
                      Income Sources <span className="text-red-500">*</span>
                    </label>
                    <textarea
                      value={form.farmerIncomeSources}
                      onChange={(e) => updateForm("farmerIncomeSources", e.target.value)}
                      rows={2}
                      className="w-full p-2.5 bg-background border rounded-md text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none resize-none"
                      placeholder="e.g. Rice farming, fish pond, small shop"
                    />
                    {errors.farmerIncomeSources && (
                      <p className="text-xs text-red-500">{errors.farmerIncomeSources}</p>
                    )}
                  </div>

                  <InputField
                    label="Business Potential"
                    value={form.businessPotential}
                    onChange={(v) => updateForm("businessPotential", v)}
                    placeholder="e.g. Strong rice output, supplies 3 FGs"
                  />

                  <InputField
                    label="Collateral Type (Jenis Jaminan)"
                    value={form.collateralType}
                    onChange={(v) => updateForm("collateralType", v)}
                    error={errors.collateralType}
                    placeholder="e.g. Sertifikat tanah, BPKB motor"
                    required
                  />

                  <InputField
                    label="Credit Limit Request Amount (IDR)"
                    value={form.creditLimitRequestAmount}
                    onChange={(v) => updateForm("creditLimitRequestAmount", v)}
                    placeholder="e.g. 25000000"
                  />
                </CardContent>
              </Card>
            )}

            {/* Section 5: Documents */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">
                  4. Documents
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <FileUploadField
                  label="Signed SO / Request Letter (SO atau Surat Permohonan yang sudah ditandatangani)"
                  fieldName="docSignedSO"
                  fileList={files.docSignedSO}
                  onFilesChange={updateFiles}
                />
                <FileUploadField
                  label="Farmer Holding Document (Foto farmer pegang dokumen)"
                  fieldName="docFarmerHolding"
                  fileList={files.docFarmerHolding}
                  onFilesChange={updateFiles}
                />

                <FileUploadField
                  label="Land Ownership Proof (Bukti kepemilikan lahan)"
                  fieldName="docLandOwnership"
                  fileList={files.docLandOwnership}
                  onFilesChange={updateFiles}
                />
                <FileUploadField
                  label="Dokumen Jaminan (Foto/scan dokumen jaminan)"
                  fieldName="docJaminan"
                  fileList={files.docJaminan}
                  onFilesChange={updateFiles}
                />

                <Separator />
                <FileUploadField
                  label="Survey Photo with TM (Foto survey dengan TM)"
                  fieldName="docSurveyPhotoTM"
                  fileList={files.docSurveyPhotoTM}
                  onFilesChange={updateFiles}
                />
              </CardContent>
            </Card>

            {/* Submit */}
            <div className="flex gap-3">
              <button
                type="submit"
                disabled={submitting}
                className="flex-1 py-3 px-6 bg-primary text-primary-foreground rounded-md font-medium text-sm hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {submitting ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
                    Submitting...
                  </span>
                ) : (
                  "Submit Request"
                )}
              </button>
              <button
                type="button"
                onClick={handleReset}
                className="py-3 px-6 border rounded-md text-sm hover:bg-muted transition-colors"
              >
                Reset
              </button>
            </div>

            {/* Edge case warnings */}
            {Object.keys(errors).length > 0 && (
              <div className="p-3 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-md">
                <p className="text-sm text-red-600 dark:text-red-400 font-medium">
                  Please fix {Object.keys(errors).length} error(s) above before submitting.
                </p>
              </div>
            )}
          </form>
        )}
      </main>
    </div>
  );
}

// Reusable input field component
function InputField({
  label,
  value,
  onChange,
  error,
  placeholder,
  type = "text",
  step,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  placeholder?: string;
  type?: string;
  step?: string;
  required?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      <input
        type={type}
        step={step}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full p-2.5 bg-background border rounded-md text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
      />
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
