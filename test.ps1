$tests = @(

# 1. BUILD + SUSTAIN
'{"answers":[{"score_build":2},{"score_sustain":1},{"score_build":1},{"score_sustain":1}]}',

# 2. SUSTAIN + REPLENISH
'{"answers":[{"score_sustain":2},{"score_replenish":1},{"score_sustain":1},{"score_replenish":1}]}',

# 3. BUILD + RESTORE
'{"answers":[{"score_build":2},{"score_restore":1},{"score_build":1},{"score_restore":1}]}',

# 4. REPLENISH + BUILD
'{"answers":[{"score_replenish":2},{"score_build":1},{"score_replenish":1},{"score_build":1}]}',

# 5. SUSTAIN ONLY
'{"answers":[{"score_sustain":2},{"score_sustain":2},{"score_sustain":1}]}',

# 6. BALANCED
'{"answers":[{"score_build":1},{"score_sustain":1},{"score_replenish":1},{"score_restore":1}]}'
)

$index = 1

foreach ($test in $tests) {

    Write-Host "`n====================================="
    Write-Host "Running Test Case $index"
    Write-Host "====================================="

    try {
        $response = Invoke-RestMethod -Uri "http://localhost:3000/submit" `
            -Method POST `
            -ContentType "application/json" `
            -Body $test

        Write-Host "Scores:" ($response.scores | ConvertTo-Json -Compress)
        Write-Host "Result:" $response.primary "+" $response.secondary
        Write-Host "Title:" $response.result.title
    }
    catch {
        Write-Host "❌ ERROR:"

        if ($_.Exception.Response -ne $null) {
            $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
            $reader.BaseStream.Position = 0
            $reader.DiscardBufferedData()
            $body = $reader.ReadToEnd()
            Write-Host "Response:" $body
        } else {
            Write-Host $_.Exception.Message
        }
    }

    $index++
}