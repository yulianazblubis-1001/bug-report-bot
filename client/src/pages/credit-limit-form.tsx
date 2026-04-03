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

type CreditLimitType = "standard" | "largeFarmer";
type CreditType = "Agri Input" | "Mechanization" | "Agri Input + Mechanization";

interface FormData {
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
  docSignedSO: File | null;
  docFarmerHolding: File | null;
  docLandOwnership: File | null;
  docJaminan: File | null;
  docSurveyPhotoTM: File | null;
}

const INITIAL_FORM: FormData = {
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
  docSignedSO: null,
  docFarmerHolding: null,
  docLandOwnership: null,
  docJaminan: null,
  docSurveyPhotoTM: null,
};

function FileUploadField({
  label,
  fieldName,
  file,
  onFileChange,
  required,
}: {
  label: string;
  fieldName: keyof FormFiles;
  file: File | null;
  onFileChange: (field: keyof FormFiles, file: File | null) => void;
  required?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      {file ? (
        <div className="flex items-center gap-2 p-2.5 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 rounded-md">
          <FileText className="w-4 h-4 text-emerald-600 flex-shrink-0" />
          <span className="text-sm truncate flex-1">{file.name}</span>
          <span className="text-xs text-muted-foreground">
            {(file.size / 1024).toFixed(0)} KB
          </span>
          <button
            type="button"
            onClick={() => {
              onFileChange(fieldName, null);
              if (inputRef.current) inputRef.current.value = "";
            }}
            className="p-1 hover:bg-red-100 dark:hover:bg-red-900/20 rounded"
          >
            <X className="w-3.5 h-3.5 text-red-500" />
          </button>
        </div>
      ) : (
        <div
          onClick={() => inputRef.current?.click()}
          className="flex items-center justify-center gap-2 p-4 border-2 border-dashed rounded-md cursor-pointer hover:border-primary/50 hover:bg-muted/30 transition-colors"
        >
          <Upload className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">
            Click to upload
          </span>
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*,.pdf,.doc,.docx"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0] || null;
          onFileChange(fieldName, f);
        }}
      />
    </div>
  );
}

export default function CreditLimitForm() {
  const [form, setForm] = useState<FormData>(INITIAL_FORM);
  const [files, setFiles] = useState<FormFiles>(INITIAL_FILES);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ success: boolean; requestId?: string; error?: string } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [prefilled, setPrefilled] = useState(false);

  const { data: agronomists } = useQuery<Agronomist[]>({
    queryKey: ["/api/agronomists"],
    staleTime: 60000,
  });

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
    setForm((prev) => ({ ...prev, [field]: value }));
    // Clear error when user types
    if (errors[field]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  }

  function updateFile(field: keyof FormFiles, file: File | null) {
    setFiles((prev) => ({ ...prev, [field]: file }));
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

      // Add files
      Object.entries(files).forEach(([key, file]) => {
        if (file) formData.append(key, file);
      });

      const res = await fetch("/api/credit-limit/submit", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (res.ok && data.success) {
        setResult({ success: true, requestId: data.requestId });
        // Reset form
        setForm(INITIAL_FORM);
        setFiles(INITIAL_FILES);
      } else {
        setResult({ success: false, error: data.error || "Something went wrong" });
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
                  <InputField
                    label="Farmer Group (FG)"
                    value={form.fgName}
                    onChange={(v) => updateForm("fgName", v)}
                    error={errors.fgName}
                    placeholder="e.g. FG Makmur Jaya"
                    required
                  />
                  <InputField
                    label="Farmer Name"
                    value={form.farmerName}
                    onChange={(v) => updateForm("farmerName", v)}
                    error={errors.farmerName}
                    placeholder="e.g. Pak Slamet"
                    required
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
                  {isLargeFarmer ? "5" : "4"}. Documents
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {includesAgriInput && (
                  <>
                    <FileUploadField
                      label="Signed SO (SO yang sudah ditandatangani)"
                      fieldName="docSignedSO"
                      file={files.docSignedSO}
                      onFileChange={updateFile}
                    />
                    <FileUploadField
                      label="Farmer Holding SO (Foto farmer pegang SO)"
                      fieldName="docFarmerHolding"
                      file={files.docFarmerHolding}
                      onFileChange={updateFile}
                    />
                  </>
                )}

                {includesMechanization && !includesAgriInput && (
                  <>
                    <FileUploadField
                      label="Signed Request Letter (Surat permohonan)"
                      fieldName="docSignedSO"
                      file={files.docSignedSO}
                      onFileChange={updateFile}
                    />
                    <FileUploadField
                      label="Farmer Holding Request Letter"
                      fieldName="docFarmerHolding"
                      file={files.docFarmerHolding}
                      onFileChange={updateFile}
                    />
                  </>
                )}

                {includesAgriInput && includesMechanization && (
                  <p className="text-xs text-amber-600 bg-amber-50 dark:bg-amber-950/20 p-2 rounded-md">
                    For "Both" type: upload Signed SO above, and Signed Request Letter as the second doc.
                  </p>
                )}

                {isLargeFarmer && (
                  <>
                    <Separator />
                    <FileUploadField
                      label="Land Ownership Proof (Bukti kepemilikan lahan)"
                      fieldName="docLandOwnership"
                      file={files.docLandOwnership}
                      onFileChange={updateFile}
                    />
                    <FileUploadField
                      label="Collateral Photo (Foto jaminan)"
                      fieldName="docJaminan"
                      file={files.docJaminan}
                      onFileChange={updateFile}
                    />
                  </>
                )}

                <Separator />
                <FileUploadField
                  label="Survey Photo with TM (Foto survey dengan TM)"
                  fieldName="docSurveyPhotoTM"
                  file={files.docSurveyPhotoTM}
                  onFileChange={updateFile}
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
