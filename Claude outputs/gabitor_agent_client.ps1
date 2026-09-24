<#
    Gabitor AI - PowerShell kliens AI agenteknek (Windows-on natívan fut,
    nem kell hozzá semmit telepíteni).

    Ezt bármelyik agented/szkripted meghívhatja, hogy képet vagy videót
    generáljon a Gabitor stúdióban - pontosan úgy, mintha a weboldalon
    kattintanál, csak API-n keresztül.

    BEÁLLÍTÁS ELŐTTE:
    1. Hozz létre egy külön Gabitor fiókot az agent csapatnak (email+jelszó),
       és tölts rá krediteket - így elkülönül a saját, kézi használatodtól.
    2. Töltsd ki lent a $GabitorDomain, $SupabaseUrl, $SupabaseAnonKey
       értékeket (Vercel projekt env változói / Supabase Settings > API).
    3. Az agent fiók email/jelszavát ne írd bele a szkriptbe - add meg
       környezeti változóként (lásd lent), vagy a Windows Credential
       Manager-ből olvasd ki, ha van rá igényed.

    HASZNÁLAT:
        # Egyszer importáld a session-be:
        . .\gabitor_agent_client.ps1

        $token = Get-GabitorToken

        $imageUrl = New-GabitorImage -Token $token -Prompt "Neon-fényű futurisztikus város éjszaka"
        Write-Host "Kép kész: $imageUrl"

        $videoUrl = New-GabitorVideo -Token $token -Prompt "Egy sárkány repül a hegyek felett napnyugtakor" -VideoTier cinematic -Duration 5
        Write-Host "Videó kész: $videoUrl"
#>

# --- Ide írd be a saját adataidat -------------------------------------------
$GabitorDomain    = "https://YOUR-GABITOR-DOMAIN.com"        # pl. https://gabitor.ai
$SupabaseUrl      = "https://YOUR-PROJECT.supabase.co"       # Supabase projekt URL
$SupabaseAnonKey  = "YOUR_SUPABASE_ANON_KEY"                 # Supabase "anon" / publishable key
# -----------------------------------------------------------------------------

function Get-GabitorToken {
    <# Bejelentkezik az agent-fiókkal, és visszaadja a Supabase access tokent.
       Az email/jelszót a GABITOR_AGENT_EMAIL / GABITOR_AGENT_PASSWORD
       környezeti változókból olvassa - állítsd be előtte pl.:
       $env:GABITOR_AGENT_EMAIL = "agent@example.com"
       $env:GABITOR_AGENT_PASSWORD = "titkosjelszo" #>
    param(
        [string]$Email = $env:GABITOR_AGENT_EMAIL,
        [string]$Password = $env:GABITOR_AGENT_PASSWORD
    )
    if (-not $Email -or -not $Password) {
        throw "Állítsd be a GABITOR_AGENT_EMAIL és GABITOR_AGENT_PASSWORD környezeti változókat."
    }
    $body = @{ email = $Email; password = $Password } | ConvertTo-Json
    $resp = Invoke-RestMethod -Method Post `
        -Uri "$SupabaseUrl/auth/v1/token?grant_type=password" `
        -Headers @{ apikey = $SupabaseAnonKey; "Content-Type" = "application/json" } `
        -Body $body
    return $resp.access_token
}

function New-GabitorImage {
    param(
        [Parameter(Mandatory)][string]$Token,
        [Parameter(Mandatory)][string]$Prompt,
        [string]$Resolution = "768",
        [string]$AspectRatio = "1:1",
        [string]$Style = "None"
    )
    $body = @{
        prompt       = $Prompt
        workflowMode = "image"
        resolution   = $Resolution
        aspectRatio  = $AspectRatio
        style        = $Style
    } | ConvertTo-Json

    $resp = Invoke-RestMethod -Method Post `
        -Uri "$GabitorDomain/api/generate2" `
        -Headers @{ Authorization = "Bearer $Token"; "Content-Type" = "application/json" } `
        -Body $body

    if ($resp.error) { throw $resp.error }
    return $resp.image
}

function New-GabitorVideo {
    <# video_tier: 'cinematic' (Kling, 4 kredit/mp - ez a legolcsóbb) vagy
       'standard' (Wan, 5-8 kredit/mp). Ha megadsz ReferenceImage-et
       (egy publikus kép URL), kép->videót csinál; enélkül szöveg->videót. #>
    param(
        [Parameter(Mandatory)][string]$Token,
        [Parameter(Mandatory)][string]$Prompt,
        [ValidateSet("cinematic", "standard")][string]$VideoTier = "cinematic",
        [ValidateSet(5, 8, 10)][int]$Duration = 5,
        [string]$AspectRatio = "16:9",
        [string]$ReferenceImage = $null,
        [int]$PollSeconds = 5,
        [int]$TimeoutSeconds = 300
    )
    $workflowMode = if ($ReferenceImage) { "video" } else { "text-video" }
    $bodyHash = @{
        prompt       = $Prompt
        workflowMode = $workflowMode
        videoTier    = $VideoTier
        duration     = $Duration
        aspectRatio  = $AspectRatio
    }
    if ($ReferenceImage) { $bodyHash.referenceImage = $ReferenceImage }
    $body = $bodyHash | ConvertTo-Json

    $resp = Invoke-RestMethod -Method Post `
        -Uri "$GabitorDomain/api/generate2" `
        -Headers @{ Authorization = "Bearer $Token"; "Content-Type" = "application/json" } `
        -Body $body

    if ($resp.error) { throw $resp.error }

    $jobId = $resp.jobId
    $provider = $resp.provider
    $waited = 0

    while ($waited -lt $TimeoutSeconds) {
        Start-Sleep -Seconds $PollSeconds
        $waited += $PollSeconds

        $status = Invoke-RestMethod -Method Get `
            -Uri "$GabitorDomain/api/video-status?jobId=$jobId&provider=$provider" `
            -Headers @{ Authorization = "Bearer $Token" }

        if ($status.video) { return $status.video }
        if ($status.error) { throw $status.error }
        # egyébként még dolgozik rajta -> tovább várunk
    }

    throw "A videó nem készült el a megadott időn belül."
}

# --- Példa futtatás (csak akkor fut le, ha közvetlenül ezt a fájlt indítod) --
if ($MyInvocation.InvocationName -ne '.') {
    $token = Get-GabitorToken
    $imageUrl = New-GabitorImage -Token $token -Prompt "Neon-fényű futurisztikus város éjszaka"
    Write-Host "Kép kész: $imageUrl"

    $videoUrl = New-GabitorVideo -Token $token -Prompt "Egy sárkány repül a hegyek felett napnyugtakor" -VideoTier cinematic -Duration 5
    Write-Host "Videó kész: $videoUrl"
}
